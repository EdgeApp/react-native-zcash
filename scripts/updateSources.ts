// Run this script as `node -r sucrase/register ./scripts/updateSources.ts`
//
// It will download third-party source code, modify it,
// and install it into the correct locations.

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { deepList, justFiles, makeNodeDisklet, navigateDisklet } from 'disklet'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'

import { copyCheckpoints } from './copyCheckpoints'

const disklet = makeNodeDisklet(join(__dirname, '../'))
const tmp = join(__dirname, '../tmp')

async function main(): Promise<void> {
  if (!existsSync(tmp)) mkdirSync(tmp)
  await downloadSources()
  await buildXcframework()
  await buildAndroidSdk()
  await copySwift()
  await copyCheckpoints(disklet)
}

// The Swift SDK commit to vendor: zodl-inc/zodl-swift-wallet-sdk main, the
// first Swift SDK source built on the NU7 librustzcash crates. ECC's
// zcash-swift-wallet-sdk is end of life and never gained NU7, and ZODL's only
// release (5.0.0) predates the NU7 crates, so there is no release asset to
// download yet. Pinned by commit so the checkout is immutable. Once ZODL tags
// an NU7 release, repoint this at that tag and restore the prebuilt download
// (see git history for the download-and-verify variant of this script).
const ZODL_SWIFT_SDK_COMMIT = '03a779959d87a8e622f178bd27db8e5f8114b112'

// The Android SDK 5.2.2 release commit. Maven Central has this release, but
// it pins the pre-release NU7 crates with no mainnet activation height, so we
// rebuild it from source with the patches below:
const ZODL_ANDROID_SDK_COMMIT = '42ebb78dc55a6822a54a4979a0ccbc461a928f95'

// The version we publish the rebuilt Android SDK under, into android/maven.
// android/build.gradle must depend on this same version:
const ZODL_ANDROID_SDK_VERSION = '5.2.2-edge-nu7'

// Both SDKs depend on these through `[patch.crates-io]`,
// so they also need porting to the final NU7 crates:
const ZCASH_VOTING_COMMIT = '9bb376295431a3c73a260ed6bbbcc870284f2db3'
const SLIPSTREAM_CRATE = {
  name: 'zodl-slipstream',
  version: '0.4.0-pre.1',
  sha256: '635eb2eb5a8360239c4cb45262065b8aa59f64ce141005714f6b5a73329fde4f'
}

/**
 * Downloads the SDK sources and ports them to the final NU7 crates
 * (zcash_protocol 0.11.0, with mainnet NU7 activation at 3,543,405).
 *
 * The patches in scripts/patches repin the librustzcash crates to their
 * final releases, adapt to the API changes between the pre-release and the
 * final crates, and pin Rust 1.97.1. Delete them once ZODL ships SDKs on the
 * final crates.
 */
async function downloadSources(): Promise<void> {
  getRepo(
    'zodl-swift-wallet-sdk',
    'https://github.com/zodl-inc/zodl-swift-wallet-sdk.git',
    ZODL_SWIFT_SDK_COMMIT
  )
  getRepo(
    'zodl-android-wallet-sdk',
    'https://github.com/zodl-inc/zodl-android-wallet-sdk.git',
    ZODL_ANDROID_SDK_COMMIT
  )
  getRepo(
    'zcash_voting',
    'https://github.com/zodl-inc/zcash_voting.git',
    ZCASH_VOTING_COMMIT
  )
  await getCrate(SLIPSTREAM_CRATE)

  applyPatch('zodl-swift-wallet-sdk', 'zodl-swift-wallet-sdk.patch')
  applyPatch('zodl-android-wallet-sdk', 'zodl-android-wallet-sdk.patch')
  applyPatch('zcash_voting', 'zcash_voting.patch')
  applyPatch(
    `${SLIPSTREAM_CRATE.name}-${SLIPSTREAM_CRATE.version}`,
    'zodl-slipstream.patch'
  )
  // libzcashlc lives in the same repo: buildXcframework() compiles it from
  // the checkout's own Rust source, so the FFI always matches the Swift code.
}

/**
 * Builds the libzcashlc XCFramework from the SDK's in-repo Rust source.
 *
 * Upstream releases ship a prebuilt libzcashlc.xcframework.zip release asset,
 * but the pinned pre-release commit has no release, so we compile the
 * staticlib with cargo for each Apple target and assemble the XCFramework
 * ourselves. cbindgen (run by the crate's build.rs) generates the C header at
 * target/Headers/zcashlc.h.
 *
 * Note: the simulator slice is arm64-only (upstream's prebuilt is a universal
 * arm64+x86_64 simulator binary). Add the x86_64-apple-ios target here if an
 * Intel-mac simulator build is ever needed.
 */
async function buildXcframework(): Promise<void> {
  const sdkPath = join(tmp, 'zodl-swift-wallet-sdk')
  const targets = ['aarch64-apple-ios', 'aarch64-apple-ios-sim']

  // Match the app's minimum iOS version instead of the host SDK's default,
  // so the linker doesn't warn about every object file:
  process.env.IPHONEOS_DEPLOYMENT_TARGET = '15.0'

  for (const target of targets) {
    console.log(`Building libzcashlc for ${target}...`)
    loudExec(sdkPath, ['rustup', 'target', 'add', target])
    loudExec(sdkPath, [
      'cargo',
      'build',
      '--locked',
      '--release',
      '--target',
      target
    ])
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
 * Builds the Android SDK from source and publishes it into android/maven,
 * a local Maven repository that ships inside our package.
 *
 * Needs the Android SDK and NDK (the version in the SDK's gradle.properties).
 */
async function buildAndroidSdk(): Promise<void> {
  const sdkPath = join(tmp, 'zodl-android-wallet-sdk')
  const targets = [
    'aarch64-linux-android',
    'armv7-linux-androideabi',
    'i686-linux-android',
    'x86_64-linux-android'
  ]

  for (const target of targets) {
    loudExec(sdkPath, ['rustup', 'target', 'add', target])
  }

  const gradleArgs = [
    '--no-daemon',
    `-PLIBRARY_VERSION=${ZODL_ANDROID_SDK_VERSION}`,
    '-PIS_SNAPSHOT=false',
    `-Dmaven.repo.local=${join(__dirname, '../android/maven')}`
  ]

  // The SDK's merge-JNI task does not wait for the Rust build when
  // publishing, so build the native libraries in their own pass first,
  // or the backend AAR ships without them:
  console.log('Building the Android native libraries...')
  loudExec(sdkPath, ['./gradlew', ...gradleArgs, ':backend-lib:cargoBuild'])

  console.log('Publishing the Android SDK...')
  await disklet.delete('android/maven')
  loudExec(sdkPath, ['./gradlew', ...gradleArgs, 'publishToMavenLocal'])
}

/**
 * Copies swift code, with modifications.
 */
async function copySwift(): Promise<void> {
  console.log('Copying swift sources...')
  const fromDisklet = navigateDisklet(
    disklet,
    'tmp/zodl-swift-wallet-sdk/Sources/ZODLSwiftWalletSDK'
  )
  const toDisklet = navigateDisklet(disklet, 'ios/ZCashLightClientKit')
  await toDisklet.delete('')
  const files = justFiles(await deepList(fromDisklet, ''))

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
      .replace(
        /(confirmationsPolicy:\s*)ConfirmationsPolicy\)/g,
        '$1SwiftConfirmationsPolicy)'
      )
      .replace(/->\s*ConfirmationsPolicy\?/g, '-> SwiftConfirmationsPolicy?')
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
      // CocoaPods names the module after the pod, so module-qualified
      // free-function calls need the pod's module name:
      .replace(/\bZODLSwiftWalletSDK\.(?=[a-z])/g, 'react_native_zcash.')
      .replace(
        `public static func from(decimal: Decimal) -> Zatoshi`,
        `public static func from(decimal: Foundation.Decimal) -> Zatoshi`
      )

    await toDisklet.setText(file, fixed)
  }

  // Copy the cbindgen-generated Rust header into the Swift location:
  await disklet.setText(
    'ios/zcashlc.h',
    await disklet.getText('tmp/zodl-swift-wallet-sdk/target/Headers/zcashlc.h')
  )
}

/**
 * Downloads a crate from crates.io, verifies its hash,
 * and extracts a fresh copy into tmp.
 */
async function getCrate(crate: {
  name: string
  version: string
  sha256: string
}): Promise<void> {
  const { name, version, sha256 } = crate
  const archivePath = join(tmp, `${name}-${version}.crate`)

  if (!existsSync(archivePath)) {
    console.log(`Downloading ${name}...`)
    const uri = `https://static.crates.io/crates/${name}/${name}-${version}.crate`
    const response = await fetch(uri)
    if (!response.ok) throw new Error(`Could not fetch ${uri}`)
    writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
  }

  const hash = createHash('sha256')
    .update(readFileSync(archivePath))
    .digest('hex')
  if (hash !== sha256) {
    unlinkSync(archivePath)
    throw new Error(`${name}-${version}.crate has hash ${hash}`)
  }

  // Extract a clean copy, since applyPatch modifies it:
  await disklet.delete(`tmp/${name}-${version}`)
  loudExec(tmp, ['tar', 'xzf', archivePath])
}

/**
 * Applies a patch from scripts/patches to a directory in tmp.
 */
function applyPatch(name: string, patch: string): void {
  console.log(`Patching ${name}...`)
  execFileSync('git', ['apply', join(__dirname, 'patches', patch)], {
    cwd: join(tmp, name),
    // Keep git from treating our own repo as the patch target
    // when the directory is not a checkout (the crate):
    env: { ...process.env, GIT_CEILING_DIRECTORIES: tmp },
    stdio: 'inherit'
  })
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

  // Remove files left by an earlier patch, but keep ignored build output:
  loudExec(path, ['git', 'clean', '-fd'])
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
