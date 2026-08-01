// Builds the SwiftPM dependency graph that the vendored ZcashLightClientKit
// source links against — grpc-swift, SwiftNIO, SwiftProtobuf, SQLite.swift and
// their C shims — into ONE static library per platform, plus the Swift
// `.swiftmodule`s and C `module.modulemap`s the in-pod SDK source needs to
// `import` them.
//
// Why this exists: as of the modern SDK, grpc-swift (1.24+) ships SwiftPM-only
// with no podspec, so it can no longer be a CocoaPods `dependency`. Instead of
// forcing the whole host app onto dynamic frameworks (the only way to consume
// the SDK via `spm_dependency`), we pre-build just these leaf dependencies into
// a static binary. The host app stays on static frameworks; the SDK *source*
// keeps compiling in-pod exactly as before (see copySwift in updateSources.ts).
//
// Output (all under ios/vendored/, gitignored, shipped in the npm tarball):
//   libZcashDeps.xcframework  - merged static lib (device arm64; sim arm64+x86_64)
//   modules/<Module>.swiftmodule  - Swift dep modules (all arch slices)
//   cmodules/<Module>/        - C dep modules (headers + module.modulemap)
//   swift-version.txt         - the Swift compiler that produced the modules
//
// The per-platform archives are packaged as ONE xcframework because
// vendored_frameworks is a real link input: CocoaPods places it on the app
// link line, where the linker pulls members on demand. (pod_target_xcconfig
// OTHER_LDFLAGS cannot do this job: a static-framework pod's Libtool step
// ignores it, and pod-target settings never propagate to the app link.)
//
// Compiler coupling: the binary .swiftmodule format is only readable by the
// exact Swift compiler that wrote it. The stable alternative (library-evolution
// .swiftinterface) is off the table BY UPSTREAM POLICY, not by accident:
// swift-nio's @inlinable-heavy style is incompatible with evolution mode, and
// the maintainers have closed every request as "not planned" (apple/swift-nio
// #2467, #2470, #2897). Don't burn time re-testing evolution on toolchain
// bumps; this only changes if NIO reverses that policy or leaves the SDK's
// dependency graph. swift-version.txt records the producing compiler so the
// podspec can fail fast with instructions when the consuming Xcode doesn't match.

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

// This repo's @types/node predates fs.cpSync/rmSync, and the sibling scripts
// already shell out for file ops, so do the same here.
function rm(path: string): void {
  execFileSync('rm', ['-rf', path])
}
function cp(src: string, dest: string): void {
  execFileSync('cp', ['-R', src, dest])
}

const root = join(__dirname, '..')
const tmp = join(root, 'tmp')
const sdkClone = join(tmp, 'ZCashLightClientKit')
const wrapper = join(tmp, 'deps-wrapper')
const vendored = join(root, 'ios/vendored')

// Targets that must NOT go into the deps binary:
//  - ZcashLightClientKit: compiled in-pod from source, not vendored as a binary
//  - ZcashDepsWrapper: our throwaway entry-point target
// (sqlite3 needs no exclusion: on Apple platforms SQLite.swift has no C-shim
// target — it imports the system `sqlite3` clang module, so its sqlite3_*
// references resolve at app link time from whatever the host app links.)
const EXCLUDED_TARGETS = ['ZcashLightClientKit', 'ZcashDepsWrapper']

interface Platform {
  archs: string[]
  destination: string
  dir: string
}

// Arch baseline matches the libzcashlc.xcframework the SDK ships: arm64
// devices, arm64 + x86_64 simulators (so Intel Macs can still build).
const PLATFORMS: Platform[] = [
  {
    archs: ['arm64'],
    destination: 'generic/platform=iOS',
    dir: 'ios-arm64'
  },
  {
    archs: ['arm64', 'x86_64'],
    destination: 'generic/platform=iOS Simulator',
    dir: 'ios-arm64-simulator'
  }
]

export function buildVendoredDeps(): void {
  console.log('Building vendored SwiftPM dependency binary...')
  rm(vendored)
  mkdirSync(join(vendored, 'modules'), { recursive: true })
  mkdirSync(join(vendored, 'cmodules'), { recursive: true })

  writeWrapperPackage()

  for (const platform of PLATFORMS) {
    console.log(`  Compiling deps for ${platform.dir}...`)
    const dd = join(tmp, `deps-dd-${platform.dir}`)
    // Always start from clean DerivedData: reusing it across SDK version bumps
    // poisons the build with stale precompiled modules of the libzcashlc
    // binary-target header ("zcashlc.h has been modified since the module file
    // was built"), surfacing as bogus cannot-find-FFI-symbol errors.
    rm(dd)
    loud(wrapper, [
      'xcodebuild',
      '-scheme',
      'ZcashDepsWrapper',
      '-configuration',
      'Release',
      '-destination',
      platform.destination,
      '-derivedDataPath',
      dd,
      // Honor the Package.resolved copied from the SDK checkout; hard-fail on
      // any version drift instead of silently re-resolving:
      '-disableAutomaticPackageResolution',
      `ARCHS=${platform.archs.join(' ')}`,
      'ONLY_ACTIVE_ARCH=NO',
      'BUILD_LIBRARY_FOR_DISTRIBUTION=NO',
      'SKIP_INSTALL=NO',
      'build'
    ])

    mergeDeps(dd, platform)
    harvestModules(dd)
  }

  // Package the per-platform archives as ONE xcframework: vendored_frameworks
  // is a real link input (CocoaPods puts it on the app link line, unlike
  // pod_target_xcconfig OTHER_LDFLAGS, which a static-framework pod's Libtool
  // step silently ignores).
  console.log('  Creating libZcashDeps.xcframework...')
  const xcframework = join(vendored, 'libZcashDeps.xcframework')
  rm(xcframework)
  const libArgs: string[] = []
  for (const platform of PLATFORMS) {
    // CocoaPods requires a UNIFORM library basename across xcframework slices
    // (mirroring libzcashlc.xcframework); stage each platform's lib under the
    // same name in its own directory:
    const stage = join(tmp, `xcfw-${platform.dir}`)
    rm(stage)
    mkdirSync(stage, { recursive: true })
    cp(
      join(vendored, `libZcashDeps-${platform.dir}.a`),
      join(stage, 'libZcashDeps.a')
    )
    libArgs.push('-library', join(stage, 'libZcashDeps.a'))
  }
  loud(tmp, [
    'xcodebuild',
    '-create-xcframework',
    ...libArgs,
    '-output',
    xcframework
  ])
  for (const platform of PLATFORMS) {
    rm(join(vendored, `libZcashDeps-${platform.dir}.a`))
  }

  writeCompilerStamp()
  assertHarvestComplete()
  console.log('Vendored deps built.')
}

// A throwaway SwiftPM package that depends on the SDK so SwiftPM builds the
// SDK's dependency graph; we then harvest those compiled deps. The SDK
// checkout's Package.resolved is copied in so the graph resolves to the EXACT
// versions the SDK release pinned, not just whatever satisfies its ranges.
function writeWrapperPackage(): void {
  rm(wrapper)
  mkdirSync(join(wrapper, 'Sources/ZcashDepsWrapper'), { recursive: true })
  writeFileSync(
    join(wrapper, 'Package.swift'),
    `// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "ZcashDepsWrapper",
  // Match the SDK's own floor (iOS 13) so the prebuilt deps import cleanly
  // from any host at or above it (Edge develop pins 15.6):
  platforms: [.iOS(.v13)],
  products: [.library(name: "ZcashDepsWrapper", type: .static, targets: ["ZcashDepsWrapper"])],
  dependencies: [.package(path: ${JSON.stringify(sdkClone)})],
  targets: [.target(name: "ZcashDepsWrapper", dependencies: [
    .product(name: "ZcashLightClientKit", package: "ZCashLightClientKit")
  ])]
)
`
  )
  writeFileSync(
    join(wrapper, 'Sources/ZcashDepsWrapper/Empty.swift'),
    '@_exported import ZcashLightClientKit\n'
  )
  const sdkPins = join(sdkClone, 'Package.resolved')
  if (!existsSync(sdkPins)) {
    throw new Error(`SDK checkout has no Package.resolved at ${sdkPins}`)
  }
  cp(sdkPins, join(wrapper, 'Package.resolved'))
}

// Merge every dependency target's compiled objects into one static lib per
// arch, then lipo the arches into the platform lib. Merging raw per-target
// objects (not the prelinked master objects) keeps every public symbol.
function mergeDeps(dd: string, platform: Platform): void {
  const objectsRoot = join(dd, 'Build/Intermediates.noindex')
  const archLibs: string[] = []

  for (const arch of platform.archs) {
    const objects = findObjects(objectsRoot, arch).filter(path => {
      if (/IntegrationTests|Benchmarks|Tests\.build|Example/.test(path)) {
        return false
      }
      return !EXCLUDED_TARGETS.some(target =>
        path.includes(`/${target}.build/`)
      )
    })
    if (objects.length === 0) {
      throw new Error(
        `No ${arch} dependency objects found under ${objectsRoot}`
      )
    }
    const listFile = join(tmp, `deps-objects-${platform.dir}-${arch}.txt`)
    writeFileSync(listFile, objects.join('\n'))
    const archLib = join(tmp, `libZcashDeps-${platform.dir}-${arch}.a`)
    rm(archLib)
    loud(tmp, ['libtool', '-static', '-o', archLib, '-filelist', listFile])
    archLibs.push(archLib)
  }

  const out = join(vendored, `libZcashDeps-${platform.dir}.a`)
  rm(out)
  if (archLibs.length === 1) {
    cp(archLibs[0], out)
  } else {
    loud(tmp, ['lipo', '-create', ...archLibs, '-output', out])
  }
}

function findObjects(base: string, arch: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (
        entry.name.endsWith('.o') &&
        dir.endsWith(`Objects-normal/${arch}`)
      ) {
        out.push(full)
      }
    }
  }
  walk(base)
  return out
}

// Copy the dep Swift `.swiftmodule`s (unioning arch slices across the
// per-platform builds) and the C modules (headers + module.modulemap) the SDK
// source imports.
function harvestModules(dd: string): void {
  const products = findProductsDir(dd)
  for (const entry of readdirSync(products)) {
    if (!entry.endsWith('.swiftmodule')) continue
    const name = entry.replace('.swiftmodule', '')
    if (EXCLUDED_TARGETS.includes(name)) continue
    const src = join(products, entry)
    const dest = join(vendored, 'modules', entry)
    if (statSync(src).isDirectory()) {
      // Union the per-platform arch slices into one .swiftmodule bundle.
      mkdirSync(dest, { recursive: true })
      cp(`${src}/.`, dest)
    } else if (!existsSync(dest)) {
      cp(src, dest)
    }
  }
  // C modules: each compiled C target maps to a checkout include/ dir with a
  // module.modulemap (synthesize a simple umbrella one if SwiftPM generated it).
  const checkouts = join(dd, 'SourcePackages/checkouts')
  if (!existsSync(checkouts)) return
  for (const obj of readdirSync(products)) {
    if (!obj.endsWith('.o')) continue
    const mod = obj.replace('.o', '')
    if (existsSync(join(vendored, 'cmodules', mod))) continue
    const inc = findInclude(checkouts, mod)
    if (inc == null) continue
    const dest = join(vendored, 'cmodules', mod)
    cp(inc, dest)
    if (!existsSync(join(dest, 'module.modulemap'))) {
      writeFileSync(
        join(dest, 'module.modulemap'),
        `module ${mod} {\n  umbrella "."\n  export *\n}\n`
      )
    }
  }
}

function findProductsDir(dd: string): string {
  const base = join(dd, 'Build/Products')
  const entry = readdirSync(base).find(name => name.startsWith('Release-'))
  if (entry == null) throw new Error(`No Products dir under ${base}`)
  return join(base, entry)
}

function findInclude(checkouts: string, mod: string): string | undefined {
  for (const pkg of readdirSync(checkouts)) {
    const inc = join(checkouts, pkg, 'Sources', mod, 'include')
    if (existsSync(inc) && readdirSync(inc).some(f => f.endsWith('.h'))) {
      return inc
    }
  }
  return undefined
}

// Record which Swift compiler produced the .swiftmodules (see the compiler
// coupling note in the file header). The podspec checks this at install time.
function writeCompilerStamp(): void {
  const versionOutput = execFileSync('xcrun', ['swift', '--version'], {
    encoding: 'utf8'
  })
  const match = versionOutput.match(/swiftlang-[0-9.]+/)
  if (match == null) {
    throw new Error(
      `Cannot parse Swift compiler version from: ${versionOutput}`
    )
  }
  writeFileSync(join(vendored, 'swift-version.txt'), `${match[0]}\n`)
}

// Guard against a layout change in xcodebuild/SwiftPM silently producing an
// empty harvest (the build would only fail much later, in a consuming app).
function assertHarvestComplete(): void {
  const moduleCount = readdirSync(join(vendored, 'modules')).filter(name =>
    name.endsWith('.swiftmodule')
  ).length
  const cmoduleCount = readdirSync(join(vendored, 'cmodules')).length
  const xcframework = join(vendored, 'libZcashDeps.xcframework')
  if (!existsSync(join(xcframework, 'Info.plist'))) {
    throw new Error(`Missing or incomplete ${xcframework}`)
  }
  if (moduleCount < 10 || cmoduleCount < 5) {
    throw new Error(
      `Vendored module harvest looks incomplete: ${moduleCount} swiftmodules, ${cmoduleCount} cmodules`
    )
  }
}

function loud(cwd: string, argv: string[]): void {
  execFileSync(argv[0], argv.slice(1), {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8'
  })
}
