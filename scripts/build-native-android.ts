import { spawn } from 'child_process'
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
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
  const { ANDROID_HOME } = process.env
  if (ANDROID_HOME == null) {
    throw new Error('ANDROID_HOME is not set in the environment.')
  }
  const sdk = ANDROID_HOME
  const ndk = join(sdk, 'ndk', '27.1.12297006')

  await run(
    'cargo',
    [
      'run',
      '--release',
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
        // eslint-disable-next-line no-template-curly-in-string -- Kotlin source, not a template
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

  // The two ABIs edge-react-gui ships. x86_64 is only for Intel emulators.
  const abis: Array<{ target: string; abi: string }> = [
    { target: 'aarch64-linux-android', abi: 'arm64-v8a' },
    { target: 'armv7-linux-androideabi', abi: 'armeabi-v7a' }
  ]
  if (process.arch !== 'arm64' || process.env.ZCASH_ANDROID_X86_64 === '1') {
    abis.push({ target: 'x86_64-linux-android', abi: 'x86_64' })
  }

  // 16 KB pages are required of 64-bit native code on Android 15+.
  const pageSizeFlags =
    '-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384'
  for (const { target, abi } of abis) {
    await run('cargo', ['ndk', '-t', abi, 'build', '--release'], rustDir, {
      ANDROID_NDK_HOME: ndk,
      CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS: pageSizeFlags,
      CARGO_TARGET_X86_64_LINUX_ANDROID_RUSTFLAGS: pageSizeFlags
    })
    const destDir = join(androidJni, abi)
    await mkdir(destDir, { recursive: true })
    // Ship one copy, under the name the app actually loads. RNZcashModule's
    // init sets `uniffi.component.zcash.libraryOverride` to `zcash`, so the
    // bindings resolve `libzcash.so` rather than the uniffi-prefixed default.
    // Shipping the same 56 MB object under both names doubled the Android
    // payload for nothing.
    await copyFile(
      join(rustDir, 'target', target, 'release', 'libzcash.so'),
      join(destDir, 'libzcash.so')
    )
    console.log(`Wrote ${join(destDir, 'libzcash.so')}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
