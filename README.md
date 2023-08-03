# react-native-zcash

This library packages the ZCashLightClientKit for use on React Native.

## Usage

First, add this library to your React Native app using NPM or Yarn, and run `pod install` as necessary to integrate it with your app's native code.

If you encounter errors during `pod install`, you may need to add the following code to the `target` section of your Podfile:

```ruby
# Zcash transitive dependencies:
pod 'CGRPCZlib', :modular_headers => true
pod 'CNIOAtomics', :modular_headers => true
pod 'CNIOBoringSSL', :modular_headers => true
pod 'CNIOBoringSSLShims', :modular_headers => true
pod 'CNIODarwin', :modular_headers => true
pod 'CNIOHTTPParser', :modular_headers => true
pod 'CNIOLinux', :modular_headers => true
pod 'CNIOWindows', :modular_headers => true
pod 'ZcashLightClientKit', :git => 'https://github.com/zcash/ZcashLightClientKit.git', :commit => '74f3ae20f26748e162c051e5fa343c71febc4294'
```

On the Android side, you may need to configure an explicit Kotlin version, so all your native dependencies will be compatible with one another. Simply define `kotlinVersion` in your `android/build.gradle` file:

```groovy
buildscript {
  ext {
    kotlinVersion = '1.8.22'
  }
}
```

### API overview

- `KeyTool`
  - `deriveViewingKey`
  - `deriveSpendingKey`
  - `getBirthdayHeight`
- `AddressTool`
  - `deriveShieldedAddress`
  - `isValidShieldedAddress`
  - `isValidTransparentAddress`
- `makeSynchronizer`
  - `start`
  - `stop`
  - `rescan`
  - `getLatestNetworkHeight`
  - `getShieldedBalance`
  - `getTransactions`
  - `sendToAddress`
