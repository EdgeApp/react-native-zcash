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

# The pre-built Swift modules under ios/vendored/ are only readable by the
# EXACT Swift compiler that produced them (the binary .swiftmodule format is
# not stable across compilers, and the stable alternative — library-evolution
# .swiftinterface — is unavailable because swift-nio rejects evolution builds
# by upstream policy; see apple/swift-nio#2470/#2897, closed "not planned").
# Fail fast with instructions instead of letting the build die later on a
# cryptic "module compiled with Swift X cannot be imported by Swift Y" error.
stamp_path = File.join(__dir__, "ios/vendored/swift-version.txt")
if File.exist?(stamp_path)
  built_with = File.read(stamp_path).strip
  local_swift = `xcrun swift --version 2>/dev/null`[/swiftlang-[0-9.]+/]
  if !built_with.empty? && !local_swift.nil? && built_with != local_swift
    raise <<~MSG
      react-native-zcash: the prebuilt Swift dependency modules in ios/vendored/
      were built with #{built_with}, but this machine's Swift compiler is
      #{local_swift}. Binary .swiftmodule files only load under the exact
      compiler that produced them.

      Fix: rebuild the vendored dependencies with your toolchain:
        cd node_modules/react-native-zcash && npm run update-sources
      (or switch to the Xcode whose Swift is #{built_with})
    MSG
  end
end

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

  # The Rust core (a binaryTarget on the SDK's GitHub release) plus the
  # pre-built SwiftPM deps (see below). Vendored frameworks are real link
  # inputs: CocoaPods adds them to the app link, where the linker pulls
  # members on demand to satisfy the in-pod SDK source's references.
  s.vendored_frameworks =
    "ios/libzcashlc.xcframework",
    "ios/vendored/libZcashDeps.xcframework"

  # ---------------------------------------------------------------------------
  # The SDK's SwiftPM-only dependencies (grpc-swift, SwiftNIO, SwiftProtobuf,
  # SQLite.swift) pre-built into one static lib per platform, plus their Swift
  # and C modules. grpc-swift 1.24+ ships SwiftPM-only with no podspec, so these
  # can no longer be CocoaPods `dependency`s; vendoring them as a static binary
  # keeps the host app on STATIC frameworks (consuming the SDK via
  # spm_dependency would force the whole app onto dynamic frameworks).
  #
  # sqlite3 is not in this binary: on Apple platforms SQLite.swift has no C-shim
  # target — it imports the system `sqlite3` clang module — so its sqlite3_*
  # references resolve at app link time from whatever the host links (in Edge,
  # its own sqlite pod and/or the sqlite embedded in libzcashlc). Note: Edge's
  # pre-existing duplicate-sqlite3 ld warnings come from libzcashlc vs
  # react-native-piratechain's libpiratelc (both Rust cores embed sqlite3) and
  # are unrelated to this package's deps binary.
  #
  # Regenerate ios/vendored/ with `npm run update-sources`
  # (scripts/buildVendoredDeps.ts).
  # ---------------------------------------------------------------------------
  s.preserve_paths = "ios/vendored/**/*"
  s.pod_target_xcconfig = {
    "SWIFT_INCLUDE_PATHS" => "\"$(PODS_TARGET_SRCROOT)/ios/vendored/modules\"",
    "OTHER_SWIFT_FLAGS" => cmodule_flags
  }
end
