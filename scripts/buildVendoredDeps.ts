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
//   libZcashDeps-ios-arm64.a            - merged static lib, device
//   libZcashDeps-ios-arm64-simulator.a  - merged static lib, simulator
//   modules/<Module>.swiftmodule  - Swift dep modules (device + sim arches)
//   cmodules/<Module>/        - C dep modules (headers + module.modulemap)
//
// Per-platform .a (rather than one xcframework) so the podspec can -force_load
// the right slice via an `[sdk=...]` condition — force_load preserves the Swift
// type metadata / protocol conformances the SDK source pulls from these deps.

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
//  - CSQLite/SQLite C shim: the host app already provides sqlite3 (Edge vendors
//    its own), so bundling it here double-defines every sqlite3_* symbol
const EXCLUDED_TARGETS = [
  'ZcashLightClientKit',
  'ZcashDepsWrapper',
  'CSQLite',
  'SQLite3' // some SQLite.swift versions name the C shim differently
]

const PLATFORMS = [
  { destination: 'generic/platform=iOS', dir: 'ios-arm64', arch: 'arm64' },
  {
    destination: 'generic/platform=iOS Simulator',
    dir: 'ios-arm64-simulator',
    arch: 'arm64'
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
    loud(wrapper, [
      'xcodebuild',
      '-scheme',
      'ZcashDepsWrapper',
      '-destination',
      platform.destination,
      '-derivedDataPath',
      dd,
      'BUILD_LIBRARY_FOR_DISTRIBUTION=NO',
      'ONLY_ACTIVE_ARCH=YES',
      'SKIP_INSTALL=NO',
      'build'
    ])

    mergeDeps(dd, platform.arch, platform.dir)
    harvestModules(dd, platform.arch)
  }
  console.log('Vendored deps built.')
}

// A throwaway SwiftPM package that depends on the SDK so SwiftPM resolves the
// SDK's EXACT dependency versions; we then harvest those compiled deps.
function writeWrapperPackage(): void {
  rm(wrapper)
  mkdirSync(join(wrapper, 'Sources/ZcashDepsWrapper'), { recursive: true })
  writeFileSync(
    join(wrapper, 'Package.swift'),
    `// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "ZcashDepsWrapper",
  platforms: [.iOS(.v16)],
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
}

// Merge every dependency target's compiled objects into one static lib, keeping
// each target's objects grouped so cross-target basename collisions don't drop
// symbols. Excludes the SDK, the wrapper, the sqlite C shim, and tests.
function mergeDeps(dd: string, arch: string, dir: string): void {
  const objectsRoot = join(dd, 'Build/Intermediates.noindex')
  const objects = findObjects(objectsRoot, arch).filter(path => {
    if (/IntegrationTests|Benchmarks|Tests\.build|Example/.test(path)) {
      return false
    }
    return !EXCLUDED_TARGETS.some(target => path.includes(`/${target}.build/`))
  })
  if (objects.length === 0) {
    throw new Error(`No dependency objects found under ${objectsRoot}`)
  }
  const listFile = join(tmp, `deps-objects-${dir}.txt`)
  writeFileSync(listFile, objects.join('\n'))
  const out = join(vendored, `libZcashDeps-${dir}.a`)
  rm(out)
  loud(tmp, ['libtool', '-static', '-o', out, '-filelist', listFile])
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

// Copy the dep Swift `.swiftmodule`s (merging device + simulator arch slices)
// and the C modules (headers + module.modulemap) the SDK source imports.
function harvestModules(dd: string, arch: string): void {
  const products = findProductsDir(dd)
  // Swift modules: copy each <Module>.swiftmodule, unioning arch slices across
  // the per-platform builds (each build contributes its own arch's slice).
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
  const entry = readdirSync(base).find(name => name.startsWith('Debug-'))
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

function loud(cwd: string, argv: string[]): void {
  execFileSync(argv[0], argv.slice(1), {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8'
  })
}
