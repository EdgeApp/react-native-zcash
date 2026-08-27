import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { join } from 'path'

const rustDir = join(__dirname, '../rust')
const androidJni = join(__dirname, '../android/src/main/jniLibs')
const androidJava = join(__dirname, '../android/src/main/java')

const cargoEnv = {
  ...process.env,
  CARGO_NET_GIT_FETCH_WITH_CLI: 'true'
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv?: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      env: { ...cargoEnv, ...extraEnv }
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function main(): Promise<void> {
  const sdk =
    process.env.ANDROID_HOME ??
    join(process.env.HOME ?? '', 'Library/Android/sdk')
  const ndk = join(sdk, 'ndk', '27.1.12297006')

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
      'kotlin',
      '--out-dir',
      androidJava
    ],
    rustDir
  )

  // UniFFI names the error field `message`, which collides with
  // Throwable.message on Kotlin 2.x. Rename the stored field.
  const kotlinPath = join(androidJava, 'uniffi/zcash/zcash.kt')
  const kotlin = await readFile(kotlinPath, 'utf8')
  await writeFile(
    kotlinPath,
    kotlin
      .replace(
        'val `message`: kotlin.String\n        ) : ZcashException() {\n        override val message\n            get() = "message=${ `message` }"',
        'val errorMessage: kotlin.String\n        ) : ZcashException() {\n        override val message\n            get() = errorMessage'
      )
      .replace(
        'FfiConverterString.allocationSize(value.`message`)',
        'FfiConverterString.allocationSize(value.errorMessage)'
      )
      .replace(
        'FfiConverterString.write(value.`message`, buf)',
        'FfiConverterString.write(value.errorMessage, buf)'
      )
  )

  const abis: Array<{ target: string; abi: string }> = [
    { target: 'aarch64-linux-android', abi: 'arm64-v8a' }
  ]
  if (process.arch !== 'arm64' || process.env.ZCASH_ANDROID_X86_64 === '1') {
    abis.push({ target: 'x86_64-linux-android', abi: 'x86_64' })
  }
  // Apple Silicon emulators are arm64; still build x86_64 when requested.
  if (process.env.ZCASH_ANDROID_X86_64 === '1') {
    // already added above for non-arm64; ensure present on arm64 hosts too
    if (!abis.some(item => item.abi === 'x86_64')) {
      abis.push({ target: 'x86_64-linux-android', abi: 'x86_64' })
    }
  }

  // Always include arm64. On Apple Silicon also include arm64 emulator.
  for (const { target, abi } of abis) {
    await run(
      'cargo',
      [
        'ndk',
        '-t',
        abi === 'arm64-v8a' ? 'arm64-v8a' : 'x86_64',
        'build',
        '--release',
        '--no-default-features',
        '--features',
        'uniffi-backend'
      ],
      rustDir,
      {
        ANDROID_NDK_HOME: ndk,
        CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS:
          '-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384'
      }
    )
    const destDir = join(androidJni, abi)
    await mkdir(destDir, { recursive: true })
    await copyFile(
      join(rustDir, 'target', target, 'release', 'libzcash.so'),
      join(destDir, 'libzcash.so')
    )
    await copyFile(join(destDir, 'libzcash.so'), join(destDir, 'libuniffi_zcash.so'))
    console.log(`Wrote ${join(destDir, 'libzcash.so')}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
