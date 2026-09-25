// swift-tools-version:5.7

// Tests for ios/CancellationSafeStream.swift against the gRPC-Swift and
// SwiftNIO versions the CocoaPods build links (see edge-react-gui's
// Podfile.lock). Run with `swift test` from this directory.

import PackageDescription

let package = Package(
  name: "StreamGuard",
  platforms: [.macOS(.v12)],
  dependencies: [
    .package(url: "https://github.com/grpc/grpc-swift.git", exact: "1.8.0"),
    .package(url: "https://github.com/apple/swift-nio.git", exact: "2.40.0"),
    .package(url: "https://github.com/apple/swift-nio-http2.git", exact: "1.22.0"),
    .package(url: "https://github.com/apple/swift-nio-ssl.git", exact: "2.19.0"),
    .package(url: "https://github.com/apple/swift-nio-transport-services.git", exact: "1.12.0"),
    .package(url: "https://github.com/apple/swift-nio-extras.git", exact: "1.11.0"),
    .package(url: "https://github.com/apple/swift-log.git", exact: "1.4.0")
  ],
  targets: [
    // The shipping helper, symlinked from ios/:
    .target(
      name: "StreamGuard",
      dependencies: [.product(name: "GRPC", package: "grpc-swift")]
    ),
    // Crash reproduction, run as a subprocess by the tests:
    .executableTarget(
      name: "CancelRepro",
      dependencies: ["StreamGuard", .product(name: "GRPC", package: "grpc-swift")]
    ),
    .testTarget(
      name: "StreamGuardTests",
      dependencies: ["StreamGuard", "CancelRepro", .product(name: "GRPC", package: "grpc-swift")]
    )
  ]
)
