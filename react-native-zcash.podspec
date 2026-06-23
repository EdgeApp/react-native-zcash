require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = package['name']
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']

  s.platform     = :ios, "13.0"
  s.source = {
    :git => "https://github.com/EdgeApp/react-native-zcash.git",
    :tag => "v#{s.version}"
  }
  # The Zcash SDK (ZcashLightClientKit) and its Rust FFI (libzcashlc), gRPC and
  # SQLite are no longer vendored into this pod. They are consumed via Swift
  # Package Manager (zcash-swift-wallet-sdk), added to the host app target. This
  # pod ships only the React Native bridge, which imports ZcashLightClientKit
  # from the SPM-provided module.
  s.source_files =
    "ios/react-native-zcash-Bridging-Header.h",
    "ios/RNZcash.m",
    "ios/RNZcash.swift"

  s.dependency "MnemonicSwift", "~> 2.2"
  s.dependency "React-Core"
end
