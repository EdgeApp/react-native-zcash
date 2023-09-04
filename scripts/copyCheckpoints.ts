import { Disklet, justFiles, navigateDisklet } from 'disklet'

/**
 * Copies checkpoints over from the Android side to the iOS side.
 */
export async function copyCheckpoints(disklet: Disklet): Promise<void> {
  console.log('Copying checkpoints...')
  const fromDisklet = navigateDisklet(
    disklet,
    'android/src/main/assets/saplingtree/mainnet'
  )
  const toDisklet = navigateDisklet(
    disklet,
    'ios/ZCashLightClientKit/Resources/checkpoints/mainnet'
  )

  const files = justFiles(await fromDisklet.list())
  for (const file of files) {
    const text = await fromDisklet.getText(file)
    await toDisklet.setText(file, text)
  }
}
