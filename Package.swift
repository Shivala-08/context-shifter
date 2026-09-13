// swift-tools-version:5.9
import PackageDescription

// Embed Info.plist into the binary at link time so the built product can be
// bundled directly into Context Transfer.app without a full Xcode project.
// (Pure stdlib — Foundation types like URL aren't available in a manifest.)
let packageRoot = String(#filePath.dropLast("/Package.swift".count))
let infoPlist = packageRoot + "/Resources/Info.plist"

let package = Package(
    name: "ContextTransfer",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "ContextTransfer",
            path: "Sources/ContextTransfer",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", infoPlist,
                ])
            ]
        )
    ]
)
