import { copyFile, mkdir } from 'fs/promises'
import { join } from 'path'

import { spawn } from 'child_process'

const rustDir = join(__dirname, '../rust')
const prebuildDir = join(
  __dirname,
  '../prebuilds',
  `${process.platform}-${process.arch}`
)

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function main(): Promise<void> {
  await run('cargo', ['build', '--release'], rustDir)
  await mkdir(prebuildDir, { recursive: true })

  const dylib =
    process.platform === 'darwin' ? 'libzcash.dylib' : 'libzcash.so'
  const built = join(rustDir, 'target', 'release', dylib)
  const dest = join(prebuildDir, 'zcash.node')
  await copyFile(built, dest)
  console.log(`Wrote ${dest}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
