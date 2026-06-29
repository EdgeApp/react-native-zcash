require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Each bundled C dep module (ios/vendored/cmodules/<Name>/ — headers +
# module.modulemap) becomes one relative clang include path, so the in-pod
# ZcashLightClientKit source can resolve the C modules that the pre-built Swift
# dependency modules (SwiftNIO / GRPC) import.
cmodule_flags = Dir.glob(File.join(__dir__, "ios/vendored/cmodules/*"))
  .select { |p| File.directory?(p) }
  .map { |p| "-Xcc -I\"$(PODS_TARGET_SRCROOT)/ios/vendored/cmodules/#{File.basename(p)}\"" }
  .join(" ")

Pod::Spec.new do |s|
  s.name         = package['name']
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']

  s.platform     = :ios, "16.0"
  s.source = {
    :git => "https://github.com/EdgeApp/react-native-zcash.git",
    :tag => "v#{s.version}"
  }

  # The bridge + the vendored ZcashLightClientKit Swift source, compiled in-pod
  # as ONE module (so the bridge uses SDK types directly — see copySwift in
  # scripts/updateSources.ts).
  s.source_files =
    "ios/react-native-zcash-Bridging-Header.h",
    "ios/RNZcash.m",
    "ios/RNZcash.swift",
    "ios/zcashlc.h",
    "ios/ZCashLightClientKit/**/*.swift"
  s.resource_bundles = {
    "zcash-mainnet" => "ios/ZCashLightClientKit/Resources/checkpoints/mainnet/*.json",
    "zcash-testnet" => "ios/ZCashLightClientKit/Resources/checkpoints/testnet/*.json"
  }

  s.dependency "MnemonicSwift", "~> 2.2"
  s.dependency "React-Core"

  # The Rust core (a binaryTarget on the SDK's GitHub release):
  s.vendored_frameworks = "ios/libzcashlc.xcframework"

  # ---------------------------------------------------------------------------
  # The SDK's SwiftPM-only dependencies (grpc-swift, SwiftNIO, SwiftProtobuf,
  # SQLite.swift) pre-built into one static lib per platform, plus their Swift
  # and C modules. grpc-swift 1.24+ ships SwiftPM-only with no podspec, so these
  # can no longer be CocoaPods `dependency`s; vendoring them as a static binary
  # keeps the host app on STATIC frameworks (consuming the SDK via
  # spm_dependency would force the whole app onto dynamic frameworks).
  #
  # sqlite3 itself is NOT bundled here (the SQLite.swift C shim is excluded in
  # buildVendoredDeps) — the host app provides it (Edge vendors its own sqlite3
  # pod), which also avoids duplicate-symbol warnings.
  #
  # Regenerate ios/vendored/ with `npm run update-sources`
  # (scripts/buildVendoredDeps.ts).
  # ---------------------------------------------------------------------------
  s.preserve_paths = "ios/vendored/**/*"
  s.pod_target_xcconfig = {
    "SWIFT_INCLUDE_PATHS" => "\"$(PODS_TARGET_SRCROOT)/ios/vendored/modules\"",
    "OTHER_SWIFT_FLAGS" => cmodule_flags,
    # force_load the matching slice so the deps' Swift type metadata / protocol
    # conformances (referenced by the SDK source) aren't dead-stripped:
    "OTHER_LDFLAGS[sdk=iphoneos*]" =>
      "-force_load \"$(PODS_TARGET_SRCROOT)/ios/vendored/libZcashDeps-ios-arm64.a\"",
    "OTHER_LDFLAGS[sdk=iphonesimulator*]" =>
      "-force_load \"$(PODS_TARGET_SRCROOT)/ios/vendored/libZcashDeps-ios-arm64-simulator.a\""
  }
end
