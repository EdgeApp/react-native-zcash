# react-native-zcash

This library packages the ZCashLightClientKit for use on React Native.

## Usage

`yarn add react-native-zcash` to install.

First, add this library to your React Native app using NPM or Yarn, and run `pod install` as necessary to integrate it with your app's native code.

## iOS

If you encounter build errors, you may need to add the following code to your Podfile:

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
```

## Android

### Change Gradle version

`react-native-zcash` is not yet compatible with gradle 8 which is the default for RN71. Replace

    distributionUrl=https\://services.gradle.org/distributions/gradle-8.0.1-all.zip

with

    distributionUrl=https\://services.gradle.org/distributions/gradle-7.5.1-all.zip

in your `gradle-wrapper.properties` file


### Define Kotlin version

In the `android/build.gradle` add the line

```groovy
    kotlinVersion = '1.6.10'
```

to the section

```groovy
    buildscript {
      ext {
        ...
        kotlinVersion = '1.6.10'
        ...
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

## Developing

This library relies on a large amount of native code from other repos. To integrate this code, you must run the following script before publishing this library to NPM:

```sh
npm run update-sources
```

This script will download ZCashLightClientKit and zcash-light-client-ffi, modify them for React Native, and integrate them with our wrapper code.

The `update-sources` script is also the place to make edits when upgrading any of the third-party dependencies.
