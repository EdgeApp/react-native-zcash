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
  s.source_files =
    "ios/react-native-zcash-Bridging-Header.h",
    "ios/RNZcash.m",
    "ios/RNZcash.swift",
    "ios/ZCashLightClientKit/**/*.swift"
  s.resource_bundles = {
    "zcash-mainnet" => "ios/ZCashLightClientKit/Resources/checkpoints/mainnet/*.json",
    "zcash-testnet" => "ios/ZCashLightClientKit/Resources/checkpoints/testnet/*.json"
  }
  s.vendored_frameworks = "ios/libzcashlc.xcframework"

  s.dependency "gRPC-Swift", "~> 1.8"
  s.dependency "SQLite.swift", "~> 0.12"
  s.dependency "React-Core"
end
