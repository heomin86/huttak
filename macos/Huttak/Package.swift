// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Huttak",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Huttak",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ],
            linkerSettings: [
                .linkedFramework("AppKit")
            ]
        )
    ]
)
