import Foundation
import ZcashLightClientKit
import os

let DerivationTools = ["mainnet": DerivationTool(networkType:ZcashNetworkBuilder.network(for: .mainnet).networkType), "testnet": DerivationTool(networkType:ZcashNetworkBuilder.network(for: .testnet).networkType)]
let NetworkParams = ["mainnet": ZcashNetworkBuilder.network(for: .mainnet), "testnet": ZcashNetworkBuilder.network(for: .testnet)]
var SynchronizerMap = [String: SDKSynchronizer]()
var loggerProxy = RNZcashLogger(logLevel: .debug)

struct ViewingKey: UnifiedViewingKey {
    var extfvk: ExtendedFullViewingKey
    var extpub: ExtendedPublicKey
}

// Used when calling reject where there isn't an error object
let genericError = NSError(domain: "", code: 0)

@objc(RNZcash)
class RNZcash : NSObject {


    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // Synchronizer
    @objc func initialize(_ extfvk: String, _ extpub: String, _ birthdayHeight: Int, _ alias: String, _ networkName: String, _ defaultHost: String, _ defaultPort: Int, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        let network = NetworkParams[networkName]
        let endpoint = LightWalletEndpoint(address: defaultHost, port: defaultPort, secure: true)
        let viewingKey = ViewingKey(extfvk: extfvk, extpub:extpub)
        let initializer = Initializer(
            cacheDbURL: try! cacheDbURLHelper(alias, network!),
            dataDbURL: try! dataDbURLHelper(alias, network!),
            pendingDbURL: try! pendingDbURLHelper(alias, network!),
            endpoint: endpoint,
            network: network!,
            spendParamsURL: try! spendParamsURLHelper(alias),
            outputParamsURL: try! outputParamsURLHelper(alias),
            viewingKeys: [viewingKey],
            walletBirthday: birthdayHeight,
            loggerProxy: loggerProxy
        )
        if (SynchronizerMap[alias] == nil) {
            do {
                let wallet = try SDKSynchronizer(initializer:initializer)
                try wallet.initialize()
                try wallet.prepare()
                SynchronizerMap[alias] = wallet
                resolve(nil)
            } catch {
                reject("InitializeError", "Synchronizer failed to initialize", error)
            }
        } else {
            // Wallet already initialized
            resolve(nil)
        }
    }

    @objc func start(_ alias: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let wallet = SynchronizerMap[alias] {
            do {
                try wallet.start()
            } catch {
                reject("StartError", "Synchronizer failed to start", error)
            } 
            resolve(nil)
        } else {
            reject("StartError", "Wallet does not exist", genericError)
        }
    }

    @objc func stop(_ alias: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let wallet = SynchronizerMap[alias] {
            wallet.stop()
            resolve(nil)
        } else {
            reject("StopError", "Wallet does not exist", genericError)
        }
    }

    // Derivation Tool
    @objc func deriveViewingKey(_ seed: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let viewingKeys: [UnifiedViewingKey] = try? DerivationTools[network]?.deriveUnifiedViewingKeysFromSeed(seed.hexaBytes, numberOfAccounts:1) {
            let out = ["extfvk": viewingKeys[0].extfvk, "extpub": viewingKeys[0].extpub]
            resolve(out);
        } else {
            reject("DeriveViewingKeyError", "Failed to derive viewing key", genericError)
        }
    }

    @objc func deriveSpendingKey(_ seed: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let spendingKeys: [String] = try? DerivationTools[network]?.deriveSpendingKeys(seed:seed.hexaBytes, numberOfAccounts:1) {
            resolve(spendingKeys[0]);
        } else {
            reject("DeriveSpendingKeyError", "Failed to derive spending key", genericError)
        }
    }

    @objc func deriveShieldedAddress(_ viewingKey: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let address: String = try? DerivationTools[network]?.deriveShieldedAddress(viewingKey:viewingKey) {
            resolve(address);
        } else {
            reject("DeriveShieldedAddressError", "Failed to derive shielded address", genericError)
        }
    }
}

// Convert hex strings to [UInt8]
extension StringProtocol {
    var hexaData: Data { .init(hexa) }
    var hexaBytes: [UInt8] { .init(hexa) }
    private var hexa: UnfoldSequence<UInt8, Index> {
        sequence(state: startIndex) { startIndex in
            guard startIndex < self.endIndex else { return nil }
            let endIndex = self.index(startIndex, offsetBy: 2, limitedBy: self.endIndex) ?? self.endIndex
            defer { startIndex = endIndex }
            return UInt8(self[startIndex..<endIndex], radix: 16)
        }
    }
}

// Local file helper funcs
func documentsDirectoryHelper() throws -> URL {
    try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
}

func cacheDbURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
    try documentsDirectoryHelper()
        .appendingPathComponent(
            network.constants.DEFAULT_DB_NAME_PREFIX + alias + ZcashSDK.DEFAULT_CACHES_DB_NAME,
            isDirectory: false
        )
}

func dataDbURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
    try documentsDirectoryHelper()
        .appendingPathComponent(
            network.constants.DEFAULT_DB_NAME_PREFIX + alias + ZcashSDK.DEFAULT_DATA_DB_NAME,
            isDirectory: false
        )
}

func pendingDbURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
    try documentsDirectoryHelper()
        .appendingPathComponent(network.constants.DEFAULT_DB_NAME_PREFIX + alias + ZcashSDK.DEFAULT_PENDING_DB_NAME)
}

func spendParamsURLHelper(_ alias: String) throws -> URL {
    try documentsDirectoryHelper().appendingPathComponent(alias + "sapling-spend.params")
}

func outputParamsURLHelper(_ alias: String) throws -> URL {
    try documentsDirectoryHelper().appendingPathComponent(alias + "sapling-output.params")
}


// Logger
class RNZcashLogger: ZcashLightClientKit.Logger {
    enum LogLevel: Int {
        case debug
        case error
        case warning
        case event
        case info
    }
    
    enum LoggerType {
        case osLog
        case printerLog
    }
    
    var level: LogLevel
    var loggerType: LoggerType
    
    init(logLevel: LogLevel, type: LoggerType = .osLog) {
        self.level = logLevel
        self.loggerType = type
    }
    
    private static let subsystem = Bundle.main.bundleIdentifier!
    static let oslog = OSLog(subsystem: subsystem, category: "logs")
    
    func debug(_ message: String, file: StaticString = #file, function: StaticString = #function, line: Int = #line) {
        guard level.rawValue == LogLevel.debug.rawValue else { return }
        log(level: "DEBUG 🐞", message: message, file: file, function: function, line: line)
    }
    
    func error(_ message: String, file: StaticString = #file, function: StaticString = #function, line: Int = #line) {
        guard level.rawValue <= LogLevel.error.rawValue else { return }
        log(level: "ERROR 💥", message: message, file: file, function: function, line: line)
    }
    
    func warn(_ message: String, file: StaticString = #file, function: StaticString = #function, line: Int = #line) {
        guard level.rawValue <= LogLevel.warning.rawValue else { return }
        log(level: "WARNING ⚠️", message: message, file: file, function: function, line: line)
    }

    func event(_ message: String, file: StaticString = #file, function: StaticString = #function, line: Int = #line) {
        guard level.rawValue <= LogLevel.event.rawValue else { return }
        log(level: "EVENT ⏱", message: message, file: file, function: function, line: line)
    }
    
    func info(_ message: String, file: StaticString = #file, function: StaticString = #function, line: Int = #line) {
        guard level.rawValue <= LogLevel.info.rawValue else { return }
        log(level: "INFO ℹ️", message: message, file: file, function: function, line: line)
    }
    
    private func log(level: String, message: String, file: StaticString = #file, function: StaticString = #function, line: Int = #line) {
        let fileName = (String(describing: file) as NSString).lastPathComponent
        switch loggerType {
        case .printerLog:
            print("[\(level)] \(fileName) - \(function) - line: \(line) -> \(message)")
        default:
            os_log(
                "[%{public}@] %{public}@ - %{public}@ - Line: %{public}d -> %{public}@",
                level,
                fileName,
                String(describing: function),
                line,
                message
            )
        }
    }
}

