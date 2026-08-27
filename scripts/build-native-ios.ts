import { copyFile, mkdir, writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { join } from 'path'

const rustDir = join(__dirname, '../rust')
const iosDir = join(__dirname, '../ios')
const generated = join(rustDir, 'Generated')

const cargoEnv = {
  ...process.env,
  CARGO_NET_GIT_FETCH_WITH_CLI: 'true',
  IPHONEOS_DEPLOYMENT_TARGET: '16.0'
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      env: cargoEnv
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function main(): Promise<void> {
  await mkdir(generated, { recursive: true })
  await run(
    'cargo',
    [
      'run',
      '--release',
      '--no-default-features',
      '--features',
      'uniffi-backend',
      '--bin',
      'uniffi-bindgen',
      'generate',
      'src/zcash.udl',
      '--language',
      'swift',
      '--out-dir',
      generated
    ],
    rustDir
  )

  const targets = ['aarch64-apple-ios', 'aarch64-apple-ios-sim']
  for (const target of targets) {
    await run(
      'cargo',
      [
        'build',
        '--release',
        '--target',
        target,
        '--no-default-features',
        '--features',
        'uniffi-backend'
      ],
      rustDir
    )
  }

  await copyFile(join(generated, 'zcash.swift'), join(iosDir, 'zcash.swift'))

  const deviceHeaders = join(generated, 'ios-device')
  const simHeaders = join(generated, 'ios-sim')
  await mkdir(deviceHeaders, { recursive: true })
  await mkdir(simHeaders, { recursive: true })
  // Only module.modulemap — also shipping zcashFFI.modulemap makes
  // -create-xcframework emit both, and Clang reports a zcashFFI redefinition.
  for (const dest of [deviceHeaders, simHeaders]) {
    await copyFile(join(generated, 'zcashFFI.h'), join(dest, 'zcashFFI.h'))
    await copyFile(
      join(generated, 'zcashFFI.modulemap'),
      join(dest, 'module.modulemap')
    )
  }

  const xc = join(iosDir, 'libzcash.xcframework')
  await run('rm', ['-rf', xc], iosDir)
  await run(
    'xcodebuild',
    [
      '-create-xcframework',
      '-library',
      join(rustDir, 'target', 'aarch64-apple-ios', 'release', 'libzcash.a'),
      '-headers',
      deviceHeaders,
      '-library',
      join(
        rustDir,
        'target',
        'aarch64-apple-ios-sim',
        'release',
        'libzcash.a'
      ),
      '-headers',
      simHeaders,
      '-output',
      xc
    ],
    iosDir
  )

  // xcodebuild rejects two libraries with the same headers path; write a
  // one-line note so the tree always has the Swift bindings even if the
  // xcframework step is re-run.
  await writeFile(
    join(iosDir, '.uniffi-generated'),
    'zcash.swift zcashFFI.h from rust/src/zcash.udl\n'
  )
  console.log(`Wrote ${xc}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
