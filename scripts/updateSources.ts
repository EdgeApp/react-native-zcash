// Run this script as `node -r sucrase/register ./scripts/updateSources.ts`
//
// It will download third-party source code, modify it,
// and install it into the correct locations.

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { deepList, justFiles, makeNodeDisklet, navigateDisklet } from 'disklet'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { buildVendoredDeps } from './buildVendoredDeps'
import { copyCheckpoints } from './copyCheckpoints'

const disklet = makeNodeDisklet(join(__dirname, '../'))
const tmp = join(__dirname, '../tmp')

async function main(): Promise<void> {
  if (!existsSync(tmp)) mkdirSync(tmp)
  await downloadSources()
  await rebuildXcframework()
  await copySwift()
  await copyCheckpoints(disklet)
  // grpc-swift (1.24+) and SwiftNIO are SwiftPM-only with no podspec, so the
  // deps the vendored SDK source links against are pre-built into a static
  // binary instead of being CocoaPods dependencies.
  buildVendoredDeps()
}

// The Swift SDK commit to vendor: the 2.7.0-rc.4 tag, the release the Zcash team
// confirmed production-ready for Ironwood (NU6.3). Pinned by commit rather than
// tag name so the checkout is immutable even if the tag is ever moved.
const ZCASH_SWIFT_SDK_COMMIT = 'fb9f6cf46fa725efa6cb9e646e13a94f05a293bf'

// SHA-256 of the libzcashlc.xcframework.zip this package links.
//
// The asset is not addressed by a URL written here: which zip to fetch, and its
// checksum, come from the pinned checkout's own binaryTarget (readBinaryTarget
// below), so the FFI can never drift from the SDK source we vendor. This
// constant is the reviewed copy of that checksum - the build stops if the two
// disagree, so bumping ZCASH_SWIFT_SDK_COMMIT has to change the native code
// deliberately rather than silently. The download is checked against it too,
// before anything is unpacked, so a tampered or swapped release asset fails the
// build instead of injecting attacker-controlled native code.
//
// To refresh it, take the `checksum:` from the new commit's Package.swift, or:
//   curl -fL <url> | shasum -a 256
const LIBZCASHLC_XCFRAMEWORK_SHA256 =
  'c012c2b682191f027c1874ecde84adeeaef26dbb3e827dd5f29deb0eb8af0ef2'

function downloadSources(): void {
  getRepo(
    'ZcashLightClientKit',
    'https://github.com/zcash/zcash-swift-wallet-sdk.git',
    ZCASH_SWIFT_SDK_COMMIT
  )
  // libzcashlc is no longer a separate package as of SDK 2.5.x — it ships as a
  // release-asset zip named by the checkout's own binaryTarget, downloaded in
  // rebuildXcframework(). Both read that one declaration, so SwiftPM builds of
  // the checkout (the vendored-deps wrapper) link the binary this package ships.
}

/**
 * Downloads and re-packages the libzcashlc XCFramework.
 *
 * As of SDK 2.5.x the FFI ships as a release-asset zip on the Swift SDK repo
 * (no longer a separate zcash-light-client-ffi package).
 *
 * An XCFramework can either include a static library (.a)
 * or a dynamically-linked library (.framework).
 * The published XCFramework stuffs a static library into a dynamic framework,
 * which doesn't work correctly.
 * We fix this by simply re-building the XCFramework.
 */
async function rebuildXcframework(): Promise<void> {
  // Take the asset to download from the pinned checkout itself, so the FFI is
  // always the one this SDK source was released against:
  const { url: zipUrl, checksum } = await readBinaryTarget()
  if (checksum !== LIBZCASHLC_XCFRAMEWORK_SHA256) {
    throw new Error(
      `The pinned SDK checkout links libzcashlc ${checksum}, but this package pins ${LIBZCASHLC_XCFRAMEWORK_SHA256}. ` +
        `Bumping ZCASH_SWIFT_SDK_COMMIT changes the native FFI too - review the new release (${zipUrl}) ` +
        `and update LIBZCASHLC_XCFRAMEWORK_SHA256 to match.`
    )
  }

  // Download the prebuilt libzcashlc XCFramework from the SDK's GitHub release.
  console.log('Downloading libzcashlc XCFramework...')
  const zipPath = join(tmp, 'libzcashlc.xcframework.zip')
  loudExec(tmp, ['curl', '--fail', '--location', '--output', zipPath, zipUrl])

  // Verify the downloaded asset against the pinned SHA-256 before unpacking it,
  // so a tampered/replaced upstream release can't inject native code into the build.
  const actualSha256 = createHash('sha256')
    .update(readFileSync(zipPath))
    .digest('hex')
  if (actualSha256 !== LIBZCASHLC_XCFRAMEWORK_SHA256) {
    throw new Error(
      `libzcashlc.xcframework.zip integrity check failed: expected ${LIBZCASHLC_XCFRAMEWORK_SHA256}, got ${actualSha256}`
    )
  }

  await disklet.delete('tmp/libzcashlc.xcframework')
  loudExec(tmp, ['unzip', '-q', '-o', zipPath])

  console.log('Creating XCFramework...')
  await disklet.delete('ios/libzcashlc.xcframework')

  // Extract the static libraries:
  await disklet.setData(
    'tmp/lib/ios-simulator/libzcashlc.a',
    await disklet.getData(
      'tmp/libzcashlc.xcframework/ios-arm64_x86_64-simulator/libzcashlc.framework/libzcashlc'
    )
  )
  await disklet.setData(
    'tmp/lib/ios/libzcashlc.a',
    await disklet.getData(
      'tmp/libzcashlc.xcframework/ios-arm64/libzcashlc.framework/libzcashlc'
    )
  )

  // Build the XCFramework:
  loudExec(tmp, [
    'xcodebuild',
    '-create-xcframework',
    '-library',
    join(__dirname, '../tmp/lib/ios-simulator/libzcashlc.a'),
    '-library',
    join(__dirname, '../tmp/lib/ios/libzcashlc.a'),
    '-output',
    join(__dirname, '../ios/libzcashlc.xcframework')
  ])
}

interface BinaryTarget {
  url: string
  checksum: string
}

/**
 * Reads the libzcashlc binaryTarget out of the pinned checkout's Package.swift,
 * where upstream declares the FFI build that matches this SDK source. Reading it
 * instead of repeating the release tag here is what makes a source/binary
 * mismatch unrepresentable: there is only one place the pair is written down.
 */
async function readBinaryTarget(): Promise<BinaryTarget> {
  const path = 'tmp/ZcashLightClientKit/Package.swift'
  const text = await disklet.getText(path)
  // The file declares exactly one binaryTarget, as a url/checksum pair. It sits
  // in the else branch of upstream's local-FFI switch, so it is in the text
  // whether or not a LocalPackages checkout happens to be active:
  const match = text.match(
    /\.binaryTarget\([^)]*?url:\s*"([^"]+)"[^)]*?checksum:\s*"([0-9a-f]{64})"/
  )
  if (match == null) {
    throw new Error(`Cannot find the libzcashlc binaryTarget in ${path}`)
  }
  return { url: match[1], checksum: match[2] }
}

/**
 * Copies swift code, with modifications.
 */
async function copySwift(): Promise<void> {
  console.log('Copying swift sources...')
  const fromDisklet = navigateDisklet(
    disklet,
    'tmp/ZCashLightClientKit/Sources'
  )
  const toDisklet = navigateDisklet(disklet, 'ios')
  await toDisklet.delete('ZCashLightClientKit/')
  const files = justFiles(await deepList(fromDisklet, 'ZCashLightClientKit/'))

  for (const file of files) {
    const text = await fromDisklet.getText(file)
    const fixed = text
      // We are lumping everything into one module,
      // so we don't need to import this externally:
      .replace('import libzcashlc', '')

      // Rename Swift struct to avoid conflict with C struct from zcashlc.h
      .replace(
        /public struct ConfirmationsPolicy\s*\{/g,
        'public struct SwiftConfirmationsPolicy {'
      )
      .replace(
        /\bConfirmationsPolicy\.init\(/g,
        'SwiftConfirmationsPolicy.init('
      )
      .replace(
        /\bConfirmationsPolicy\.default/g,
        'SwiftConfirmationsPolicy.default'
      )
      .replace(/:\s*ConfirmationsPolicy\s*=/g, ': SwiftConfirmationsPolicy =')
      .replace(/\bConfirmationsPolicy\s*:/g, 'SwiftConfirmationsPolicy:')
      .replace(/libzcashlc\.ConfirmationsPolicy/g, 'ConfirmationsPolicy')

      // Replace serializedBytes with serializedData
      .replace(
        /LightdInfo\(serializedBytes:\s*data\)/g,
        'LightdInfo(serializedData: data)'
      )
      .replace(
        /TreeState\(serializedBytes:\s*data\)/g,
        'TreeState(serializedData: data)'
      )
      .replace(/FfiProposal\(serializedBytes:/g, 'FfiProposal(serializedData:')

      // The Swift package manager synthesizes a "Bundle.module" accessor,
      // but with CocoaPods we need to load things manually:
      .replace(
        'Bundle.module.bundleURL.appendingPathComponent("checkpoints/mainnet/")',
        'Bundle.main.url(forResource: "zcash-mainnet", withExtension: "bundle")!'
      )
      .replace(
        'Bundle.module.bundleURL.appendingPathComponent("checkpoints/testnet/")',
        'Bundle.main.url(forResource: "zcash-testnet", withExtension: "bundle")!'
      )
      // The regtest checkpoint directory does not exist as a resource (and
      // RegtestCheckpointSource never reads it — it synthesizes an empty-tree
      // checkpoint), so this only needs to compile under CocoaPods:
      .replace(
        'Bundle.module.bundleURL.appendingPathComponent("checkpoints/regtest/")',
        'Bundle.main.bundleURL.appendingPathComponent("checkpoints/regtest/")'
      )
      // This block of code uses "Bundle.module" too,
      // but we can just delete it since phone builds don't need it:
      .replace(/static let macOS = BundleCheckpointURLProvider.*}\)/s, '')
      .replace(
        `public static func from(decimal: Decimal) -> Zatoshi`,
        `public static func from(decimal: Foundation.Decimal) -> Zatoshi`
      )

    await toDisklet.setText(file, fixed)
  }

  // Copy the Rust header into the Swift location:
  await disklet.setText(
    'ios/zcashlc.h',
    await disklet.getText(
      'tmp/libzcashlc.xcframework/ios-arm64/libzcashlc.framework/Headers/zcashlc.h'
    )
  )
}

/**
 * Clones a git repo and checks our a hash.
 */
function getRepo(name: string, uri: string, hash: string): void {
  const path = join(tmp, name)

  // Clone cheaply, then fetch just the pinned commit if needed:
  if (!existsSync(path)) {
    console.log(`Cloning ${name}...`)
    loudExec(tmp, [
      'git',
      'clone',
      '--no-checkout',
      '--filter=blob:none',
      '--no-tags',
      uri,
      name
    ])
  }

  if (!hasCommit(path, hash)) {
    console.log(`Fetching ${name}...`)
    try {
      loudExec(path, ['git', 'fetch', '--depth=1', '--no-tags', 'origin', hash])
    } catch (error) {
      console.log(error)
    }
  }

  // Checkout:
  console.log(`Checking out ${name}...`)
  loudExec(path, ['git', 'checkout', '-f', hash])
}

function hasCommit(path: string, hash: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], {
      cwd: path,
      stdio: 'ignore'
    })
    return true
  } catch (error) {
    return false
  }
}

/**
 * Runs a command and displays its results.
 */
function loudExec(path: string, argv: string[]): void {
  execFileSync(argv[0], argv.slice(1), {
    cwd: path,
    stdio: 'inherit',
    encoding: 'utf8'
  })
}

main().catch(error => {
  console.log(error)
  process.exit(1)
})
