import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { makeNodeZcashModule, Tools } from '../src/node'

async function main(): Promise<void> {
  const documentDirectory = mkdtempSync(join(tmpdir(), 'rnzcash-smoke-'))
  const io = makeNodeZcashModule({ documentDirectory })

  const valid = await io.Tools.isValidAddress(
    't1Hsc1LR8yKnbbe3twRp88p6vFfC5tjrD3L',
    'mainnet'
  )
  if (typeof valid !== 'boolean') {
    throw new Error('isValidAddress did not return a boolean')
  }

  const birthday = await io.Tools.getBirthdayHeight('zec.rocks', 443)
  if (!(birthday > 0)) {
    throw new Error(`getBirthdayHeight returned ${birthday}`)
  }

  const ironwood = await io.Tools.getIronwoodActivationHeight('mainnet')
  if (ironwood !== 3428143) {
    throw new Error(`unexpected ironwood height ${String(ironwood)}`)
  }

  const mnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
  const viewingKey = await Tools.deriveViewingKey(mnemonic, 'mainnet')
  if (!viewingKey.startsWith('uview')) {
    throw new Error(`unexpected viewing key prefix: ${viewingKey.slice(0, 12)}`)
  }

  const synchronizer = await io.makeSynchronizer({
    mnemonicSeed: mnemonic,
    birthdayHeight: birthday,
    alias: 'smoke',
    networkName: 'mainnet',
    defaultHost: 'zec.rocks',
    defaultPort: 443,
    newWallet: true
  })
  const addresses = await synchronizer.deriveUnifiedAddress()
  if (!addresses.unifiedAddress.startsWith('u1')) {
    throw new Error(`unified: ${addresses.unifiedAddress}`)
  }
  if (!addresses.saplingAddress.startsWith('zs1')) {
    throw new Error(`sapling: ${addresses.saplingAddress}`)
  }
  if (!addresses.transparentAddress.startsWith('t')) {
    throw new Error(`transparent: ${addresses.transparentAddress}`)
  }

  console.log('smoke ok')
  console.log(JSON.stringify({ birthday, addresses }, null, 2))
  await synchronizer.stop()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
