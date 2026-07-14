// Run this script as `node -r sucrase/register ./scripts/updateSources.ts`
//
// It will download third-party source code, modify it,
// and install it into the correct locations.

import { execFileSync } from 'child_process'
import { deepList, justFiles, makeNodeDisklet, navigateDisklet } from 'disklet'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { copyCheckpoints } from './copyCheckpoints'

const disklet = makeNodeDisklet(join(__dirname, '../'))
const tmp = join(__dirname, '../tmp')

async function main(): Promise<void> {
  if (!existsSync(tmp)) mkdirSync(tmp)
  await downloadSources()
  await buildXcframework()
  await copySwift()
  await copyCheckpoints(disklet)
}

// The Swift SDK commit to vendor. This is ECC's Ironwood (NU6.3) integration
// branch `harry/ironwood-nu6.3-deps`, which pins librustzcash's feat/ironwood
// work for the July 28, 2026 network upgrade (block 3428143). No upstream
// release ships NU6.3 yet (2.6.0-alpha.6 and Maven 2.5.2 are both NU6.2), so
// the FFI is built from the SDK's in-repo Rust source instead of downloading
// the prebuilt libzcashlc.xcframework release asset. Once ECC publishes an
// NU6.3 release, repoint this at that tag and restore the prebuilt download
// (see git history for the download-and-verify variant of this script).
const ZCASH_SWIFT_SDK_COMMIT = '666819356aabfd18ebdf3c2368620d8107af4087'

function downloadSources(): void {
  getRepo(
    'ZcashLightClientKit',
    'https://github.com/zcash/zcash-swift-wallet-sdk.git',
    // harry/ironwood-nu6.3-deps:
    ZCASH_SWIFT_SDK_COMMIT
  )
  // libzcashlc is not a separate package as of SDK 2.5.x. Upstream ships it as
  // a binaryTarget zip on each release; this pre-release Ironwood pin has no
  // release asset, so buildXcframework() compiles it from the SDK's rust/ tree.
}

/**
 * Builds the libzcashlc XCFramework from the SDK's in-repo Rust source.
 *
 * Upstream releases ship a prebuilt libzcashlc.xcframework.zip release asset,
 * but the pinned Ironwood pre-release commit has no release, so we compile the
 * staticlib with cargo for each Apple target and assemble the XCFramework
 * ourselves. cbindgen (run by the crate's build.rs) generates the C header at
 * target/Headers/zcashlc.h.
 *
 * Note: the simulator slice is arm64-only (upstream's prebuilt is a universal
 * arm64+x86_64 simulator binary). Add the x86_64-apple-ios target here if an
 * Intel-mac simulator build is ever needed.
 */
async function buildXcframework(): Promise<void> {
  const sdkPath = join(tmp, 'ZcashLightClientKit')
  const targets = ['aarch64-apple-ios', 'aarch64-apple-ios-sim']

  // Match the app's minimum iOS version instead of the host SDK's default,
  // so the linker doesn't warn about every object file:
  process.env.IPHONEOS_DEPLOYMENT_TARGET = '15.0'

  for (const target of targets) {
    console.log(`Building libzcashlc for ${target}...`)
    loudExec(sdkPath, ['rustup', 'target', 'add', target])
    loudExec(sdkPath, ['cargo', 'build', '--release', '--target', target])
  }

  console.log('Creating XCFramework...')
  await disklet.delete('ios/libzcashlc.xcframework')
  loudExec(tmp, [
    'xcodebuild',
    '-create-xcframework',
    '-library',
    join(sdkPath, 'target/aarch64-apple-ios-sim/release/libzcashlc.a'),
    '-library',
    join(sdkPath, 'target/aarch64-apple-ios/release/libzcashlc.a'),
    '-output',
    join(__dirname, '../ios/libzcashlc.xcframework')
  ])
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
  const allFiles = justFiles(
    await deepList(fromDisklet, 'ZCashLightClientKit/')
  )

  // The Ironwood pre-release branch defers the SDK's voting feature (its
  // zcash_voting dependency does not resolve against the feat/ironwood
  // librustzcash pins), so the FFI built above has no zcashlc_voting_*
  // symbols. Exclude the self-contained voting backend Swift so nothing
  // references them; react-native-zcash exposes no voting API.
  const files = allFiles.filter(file => !file.includes('Rust/Voting/'))

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
      // This block of code uses "Bundle.module" too,
      // but we can just delete it since phone builds don't need it:
      .replace(/static let macOS = BundleCheckpointURLProvider.*}\)/s, '')
      .replace(
        `public static func from(decimal: Decimal) -> Zatoshi`,
        `public static func from(decimal: Foundation.Decimal) -> Zatoshi`
      )

    await toDisklet.setText(file, fixed)
  }

  // Copy the cbindgen-generated Rust header into the Swift location:
  await disklet.setText(
    'ios/zcashlc.h',
    await disklet.getText('tmp/ZcashLightClientKit/target/Headers/zcashlc.h')
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
