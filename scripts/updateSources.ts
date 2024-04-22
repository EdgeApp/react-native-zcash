// Run this script as `node -r sucrase/register ./scripts/updateSources.ts`
//
// It will download third-party source code, modify it,
// and install it into the correct locations.

import { execSync } from 'child_process'
import { deepList, justFiles, makeNodeDisklet, navigateDisklet } from 'disklet'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { copyCheckpoints } from './copyCheckpoints'

const disklet = makeNodeDisklet(join(__dirname, '../'))
const tmp = join(__dirname, '../tmp')

async function main(): Promise<void> {
  if (!existsSync(tmp)) mkdirSync(tmp)
  await downloadSources()
  await rebuildXcframework()
  await copySwift()
  await copyCheckpoints(disklet)
}

function downloadSources(): void {
  getRepo(
    'ZcashLightClientKit',
    'https://github.com/Electric-Coin-Company/zcash-swift-wallet-sdk.git',
    // 2.1.5:
    '31a584801302c04f8c644f652d44d25406007f5e'
  )
  getRepo(
    'zcash-light-client-ffi',
    'https://github.com/Electric-Coin-Company/zcash-light-client-ffi.git',
    // 0.8.0:
    '9314c83d7a09d88e1c0bd3ff3738a50833325059'
  )
}

/**
 * Re-packages zcash-light-client-ffi.
 *
 * An XCFramework can either include a static library (.a)
 * or a dynamically-linked library (.framework).
 * The zcash-light-client-ffi package tries to stuff a static library
 * into a dynamic framework, which doesn't work correctly.
 * We fix this by simply re-building the XCFramework.
 */
async function rebuildXcframework(): Promise<void> {
  console.log('Creating XCFramework...')
  await disklet.delete('ios/libzcashlc.xcframework')

  // Extract the static libraries:
  await disklet.setData(
    'tmp/lib/ios-simulator/libzcashlc.a',
    await disklet.getData(
      'tmp/zcash-light-client-ffi/releases/XCFramework/libzcashlc.xcframework/ios-arm64_x86_64-simulator/libzcashlc.framework/libzcashlc'
    )
  )
  await disklet.setData(
    'tmp/lib/ios/libzcashlc.a',
    await disklet.getData(
      'tmp/zcash-light-client-ffi/releases/XCFramework/libzcashlc.xcframework/ios-arm64/libzcashlc.framework/libzcashlc'
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

    await toDisklet.setText(file, fixed)
  }

  // Copy the Rust header into the Swift location:
  await disklet.setText(
    'ios/ZCashLightClientKit/Rust/zcashlc.h',
    await disklet.getText(
      'tmp/zcash-light-client-ffi/releases/XCFramework/libzcashlc.xcframework/ios-arm64/libzcashlc.framework/Headers/zcashlc.h'
    )
  )
}

/**
 * Clones a git repo and checks our a hash.
 */
function getRepo(name: string, uri: string, hash: string): void {
  const path = join(tmp, name)

  // Either clone or fetch:
  if (!existsSync(path)) {
    console.log(`Cloning ${name}...`)
    loudExec(tmp, ['git', 'clone', uri, name])
  } else {
    // We might already have the right commit, so fetch lazily:
    try {
      loudExec(path, ['git', 'fetch'])
    } catch (error) {
      console.log(error)
    }
  }

  // Checkout:
  console.log(`Checking out ${name}...`)
  execSync(`git checkout -f ${hash}`, {
    cwd: path,
    stdio: 'inherit',
    encoding: 'utf8'
  })
}

/**
 * Runs a command and displays its results.
 */
function loudExec(path: string, argv: string[]): void {
  execSync(argv.join(' '), {
    cwd: path,
    stdio: 'inherit',
    encoding: 'utf8'
  })
}

main().catch(error => {
  console.log(error)
  process.exit(1)
})
