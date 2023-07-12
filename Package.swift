// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "react-native-zcash",
    platforms: [
        .iOS(.v12),
        .macOS(.v12)
    ],
    products: [
    //   .library(name: "react-native-zcash", targets: ["react-native-zcash"]),
      .library(name: "react-native-zcash", targets: ["RNZcash", "RNZcashSwift"]),
    //   .library(name: "Pods", targets: ["RNZcash", "RNZcashSwift"]),
    ],
    dependencies: [
        // .package(url: "https://github.com/facebook/react.git", from: "17.0.2"),
        // .package(url: "https://github.com/EdgeApp/ZcashLightClientKit.git", revision: "c36c79c3d3cfdfc01054795d834d1742d1a7914d"),
        .package(url: "https://github.com/peachbits/ZcashLightClientKit.git", revision: "f6ebf973af37129588eb249fe7487c91731ace33"),
    ],
    targets: [
        .target(
            name: "RNZcash",
            dependencies: [
                // "ZcashLightClientKit",
                "RNZcashSwift",
                // "React"
            ],
            path: "ios/RNZcashObjC",
            publicHeadersPath: "ios/RNZcashObjC"
            ),
        .target(
            name: "RNZcashSwift",
            dependencies: [
                "ZcashLightClientKit",
            ],
            path: "ios/RNZcashSwift"
            // publicHeadersPath: "ios/RNZcashObjC"
            )
        // .target(
        //     name: "react-native-zcash",
        //     dependencies: [
        //         "ZcashLightClientKit",
        //     ],
        //     // path: "ios"
        //     path: "ios/RNZcashSwift"
        //     // publicHeadersPath: "ios/RNZcashObjC"
        //     )
    ]
)
