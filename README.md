# React Native Zcash

[![Build Status](https://travis-ci.org/EdgeApp/react-native-zcash.svg?branch=master)](https://travis-ci.org/EdgeApp/react-native-zcash)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## React Native

To use this library on React Native, run `yarn add react-native-zcash` to install it. Then add these lines to your Podspec file, to work around certain compatiblity issues between the ZCash SDK and React Native:

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

## API overview

TODO
