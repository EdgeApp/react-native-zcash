# React Native Zcash

[![Build Status](https://travis-ci.org/EdgeApp/react-native-zcash.svg?branch=master)](https://travis-ci.org/EdgeApp/react-native-zcash)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

`yarn add react-native-zcash` to install.

## iOS

To use this library on iOS add these lines to your Podspec file, to work around certain compatiblity issues between the ZCash SDK and React Native:

```ruby
pod 'CNIOAtomics', :modular_headers => true
pod 'CNIOBoringSSL', :modular_headers => true
pod 'CNIOBoringSSLShims', :modular_headers => true
pod 'CNIOLinux', :modular_headers => true
pod 'CNIODarwin', :modular_headers => true
pod 'CNIOHTTPParser', :modular_headers => true
pod 'CNIOWindows', :modular_headers => true
pod 'CGRPCZlib', :modular_headers => true
pod 'ZcashLightClientKit', :git => 'https://github.com/zcash/ZcashLightClientKit.git', :commit => '74f3ae20f26748e162c051e5fa343c71febc4294'
```

Finally, you can use CocoaPods to integrate the library with your project:

```bash
cd ios
pod install
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

    kotlinVersion = '1.6.10'

to the section

    buildscript {
      ext {
        ...
        kotlinVersion = '1.6.10'
        ...
      }
    }

## API overview

TODO
