# react-native-zcash

This library packages [zingolib](https://github.com/zingolabs/zingolib) for use on React Native, through a Rust crate under `rust/` that UniFFI binds to Swift and Kotlin.

## Usage

First, add this library to your React Native app using NPM or Yarn, and run `pod install` as necessary to integrate it with your app's native code.

On the Android side, you may need to configure an explicit Kotlin version, so all your native dependencies will be compatible with one another. Simply define `kotlinVersion` in your `android/build.gradle` file:

```groovy
buildscript {
  ext {
    kotlinVersion = '1.8.22'
  }
}
```

### API overview

- `Tools`
  - `deriveViewingKey`
  - `getBirthdayHeight`
  - `isValidAddress`
- `makeSynchronizer`
  - `start`
  - `stop`
  - `rescan`
  - `getLatestNetworkHeight`
  - `sendToAddress`
  - `shieldFunds`
  - `deriveUnifiedAddress`

`Tools` contains methods that don't require a running synchronizer (with one exception, `isValidAddress` on Android which does requires any synchronizer connected to the requested network). In addition to the methods above, the following events can be subscribed to:

- `BalanceEvent`- available and total transparent and shielded balances
- `StatusEvent` - current synchronizer activity (`STOPPED`, `DISCONNECTED`, `SYNCING`, and `SYNCED`)
- `TransactionEvent`- confirmed transactions
- `UpdateEvent` - syncing progress and network height

## Developing

The native libraries are built from `rust/` and are not checked in. Build them before running the library in an app or publishing it to NPM:

```sh
npm run build-native-ios
npm run build-native-android
```

The iOS script writes `ios/libzcash.xcframework` and the Swift bindings. The Android script writes `android/src/main/jniLibs/` and the Kotlin bindings, and needs `cargo-ndk` and Android NDK 27.1.12297006. `prepublishOnly` runs both. zingolib is pinned by git revision in `rust/Cargo.toml`.

The Sapling proving parameters are not bundled. The library downloads them into the app's document directory the first time a wallet holds Sapling funds, and before signing a send that needs them.

### Source Formatting

Install `ktlint` and `swift-format` using your package manager, such as `brew install ktlint swift-format`. Run `fix-swift` or `fix-kotlin` to format the native sources.
