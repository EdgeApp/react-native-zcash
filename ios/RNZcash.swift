import Foundation
import ZcashLightClientKit
import os

var SynchronizerMap = [String: WalletSynchronizer]()
var loggerProxy = RNZcashLogger(logLevel: .debug)


struct ConfirmedTx {
    var minedHeight: Int
    var toAddress: String?
    var rawTransactionId: String
    var blockTimeInSeconds: Int
    var value: String
    var memo: String?
    var dictionary: [String: Any] {
        return [
            "minedHeight": minedHeight,
            "toAddress": toAddress,
            "rawTransactionId": rawTransactionId,
            "blockTimeInSeconds": blockTimeInSeconds,
            "value": value,
            "memo": memo
        ]
    }
    var nsDictionary: NSDictionary {
        return dictionary as NSDictionary
    }
}

struct ShieldedBalance {
    var availableZatoshi: String
    var totalZatoshi: String
    var dictionary: [String: Any] {
        return [
            "availableZatoshi": availableZatoshi,
            "totalZatoshi": totalZatoshi
        ]
    }
    var nsDictionary: NSDictionary {
        return dictionary as NSDictionary
    }
}

struct ProcessorState {
    var alias: String
    var lastDownloadedHeight: Int
    var lastScannedHeight: Int
    var scanProgress: Int
    var networkBlockHeight: Int
    var dictionary: [String: Any] {
        return [
            "alias": alias,
            "lastDownloadedHeight": lastDownloadedHeight,
            "lastScannedHeight": lastScannedHeight,
            "scanProgress": scanProgress,
            "networkBlockHeight": networkBlockHeight
        ]
    }
    var nsDictionary: NSDictionary {
        return dictionary as NSDictionary
    }
}

// Used when calling reject where there isn't an error object
let genericError = NSError(domain: "", code: 0)

@objc(RNZcash)
class RNZcash : RCTEventEmitter {

    override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    private func getNetworkParams(_ network: String) -> ZcashNetwork {
    switch network {
        case "testnet":
            return ZcashNetworkBuilder.network(for: .testnet)
        default:
            return ZcashNetworkBuilder.network(for: .mainnet)
        }
    }

    /**
     Synchronizer: initialize without access to seed phrase. It might fail because it's needed
     */
    @objc func initialize(ufvk: String, _ birthdayHeight: Int, _ alias: String, _ networkName: String, _ defaultHost: String, _ defaultPort: Int, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        let network = getNetworkParams(networkName)
        let endpoint = LightWalletEndpoint(address: defaultHost, port: defaultPort, secure: true)

        let ufvk = try! UnifiedFullViewingKey(encoding: ufvk, account: 0, network: network.networkType)

        let initializer = Initializer(
            cacheDbURL: try! cacheDbURLHelper(alias, network),
            dataDbURL: try! dataDbURLHelper(alias, network),
            pendingDbURL: try! pendingDbURLHelper(alias, network),
            endpoint: endpoint,
            network: network,
            spendParamsURL: try! spendParamsURLHelper(alias),
            outputParamsURL: try! outputParamsURLHelper(alias),
            viewingKeys: [ufvk],
            walletBirthday: birthdayHeight,
            loggerProxy: loggerProxy
        )
        if (SynchronizerMap[alias] == nil) {
            do {
                let wallet = try WalletSynchronizer(alias:alias, initializer:initializer, emitter:sendToJs)
                guard try wallet.synchronizer.prepare(with: nil) == .success else {

                    reject("InitializeError", "Seed required to initialize", SynchronizerError.initFailed(message: "Seed required to initialize"))
                    return 
                }


                SynchronizerMap[alias] = wallet
                resolve(nil)
            } catch {

            }
        } else {
            // Wallet already initialized
            resolve(nil)
        }
    }

    /**
     Synchronizer: initialize without access to seed phrase. It might fail because it's needed
     */
    @objc func initialize(seed: String, _ birthdayHeight: Int, _ alias: String, _ networkName: String, _ defaultHost: String, _ defaultPort: Int, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        let network = getNetworkParams(networkName)
        let endpoint = LightWalletEndpoint(address: defaultHost, port: defaultPort, secure: true)

        let spendingKey = try! DerivationTool(networkType: network.networkType).deriveUnifiedSpendingKey(seed: seed.hexaBytes, accountIndex: 0)

        let ufvk = try! spendingKey.deriveFullViewingKey()

        let initializer = Initializer(
            cacheDbURL: try! cacheDbURLHelper(alias, network),
            dataDbURL: try! dataDbURLHelper(alias, network),
            pendingDbURL: try! pendingDbURLHelper(alias, network),
            endpoint: endpoint,
            network: network,
            spendParamsURL: try! spendParamsURLHelper(alias),
            outputParamsURL: try! outputParamsURLHelper(alias),
            viewingKeys: [ufvk],
            walletBirthday: birthdayHeight,
            loggerProxy: loggerProxy
        )
        if (SynchronizerMap[alias] == nil) {
            do {
                let wallet = try WalletSynchronizer(alias:alias, initializer:initializer, emitter:sendToJs)
                guard try wallet.synchronizer.prepare(with: seed.hexaBytes) == .success else {

                    reject("InitializeError", "Seed required to initialize", SynchronizerError.initFailed(message: "Seed required to initialize"))
                    return
                }

                SynchronizerMap[alias] = wallet
                resolve(nil)
            } catch {
                reject("InitializeError", "failed to initialize synchronizer", error)
            }
        } else {
            // Wallet already initialized
            resolve(nil)
        }
    }


    @objc func start(_ alias: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let wallet = SynchronizerMap[alias] {
            do {
                try wallet.synchronizer.start()
                wallet.subscribe()
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
            wallet.synchronizer.stop()
            SynchronizerMap[alias] = nil
            resolve(nil)
        } else {
            reject("StopError", "Wallet does not exist", genericError)
        }
    }

    @objc func spendToAddress(_ alias: String, _ zatoshi: String, _ toAddress: String, _ memo: String, _ fromAccountIndex: Int, _ seed: String, network: String , resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) -> Void {
        Task.detached {
            guard let wallet = SynchronizerMap[alias] else {
                reject("SpendToAddressError", "Wallet does not exist", genericError)
                return
            }

            let network = self.getNetworkParams(network)

            guard let spendingKey = try? DerivationTool(networkType: network.networkType).deriveUnifiedSpendingKey(seed: seed.hexaBytes, accountIndex: fromAccountIndex) else {
                reject("SpendToAddressError", "Spending Key derivation error", genericError)
                return
            }

            guard let recipient = try? Recipient(toAddress, network: network.networkType) else {
                reject("SpendToAddressError", "Recipient is invalid", genericError)
                return
            }


            guard let amount = Int64(zatoshi) else {
                reject("SpendToAddressError", "Amount is invalid", genericError)
                return
            }

            guard let memo = Self.getMemo(string: memo) else {
                reject("SpendToAddressError", "Invalid memo", genericError)
                return
            }


            do {
                let pendingTransaction = try await wallet.synchronizer.sendToAddress(spendingKey: spendingKey, zatoshi: Zatoshi(amount), toAddress: recipient, memo: memo)

                if (pendingTransaction.rawTransactionId != nil && pendingTransaction.raw != nil) {
                    let tx: NSDictionary = ["txId": pendingTransaction.rawTransactionId!.toHexStringTxId(), "raw":z_hexEncodedString(data:pendingTransaction.raw!)]
                    resolve(tx)
                } else {
                    reject("SpendToAddressError", "Missing txid or rawtx in success object", genericError)
                }
            } catch {
                reject("SpendToAddressError", "Failed to spend", error)
            }
        }
    }

    @objc func getTransactions(_ alias: String, _ first: Int, _ last: Int, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let wallet = SynchronizerMap[alias] {
            if !wallet.fullySynced {
                reject("GetTransactionsError", "Wallet is not synced", genericError)
                return
            }
            var out: [NSDictionary] = []
            if let txs = try? wallet.synchronizer.allConfirmedTransactions(from:nil, limit:Int.max) {
                // Get all txs, all the time, because the iOS SDK doesn't support querying by block height
                for tx in txs {
                    if (tx.rawTransactionId != nil) {
                        var confTx = ConfirmedTx(
                            minedHeight: tx.minedHeight,
                            rawTransactionId: (tx.rawTransactionId?.toHexStringTxId())!,
                            blockTimeInSeconds: Int(tx.blockTimeInSeconds),
                            value: String(describing: tx.value)
                        )
                        if (tx.toAddress != nil) {
                            confTx.toAddress = tx.toAddress
                        }
                        if (tx.memo != nil) {
                            confTx.memo = String(bytes: tx.memo!, encoding: .utf8)
                        }
                        out.append(confTx.nsDictionary)
                    }
                }
                resolve(out)
            } else {
                reject("GetTransactionsError", "Failed to query transactions", genericError)
            }
        } else {
            reject("GetTransactionsError", "Wallet does not exist", genericError)
        }
    }

    @objc func getShieldedBalance(_ alias: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let wallet = SynchronizerMap[alias] {
            let total = wallet.synchronizer.getShieldedBalance().decimalValue.decimalString
            let available = wallet.synchronizer.getShieldedVerifiedBalance().decimalValue.decimalString
            let balance = ShieldedBalance(availableZatoshi:available, totalZatoshi:total)
            resolve(balance.nsDictionary)
        } else {
            reject("GetShieldedBalanceError", "Wallet does not exist", genericError)
        }
    }

    @objc func rescan(_ alias: String, _ height: Int, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) -> Void {
        Task.detached {
            if let wallet = SynchronizerMap[alias] {
                do {
                    try await wallet.synchronizer.rewind(.height(blockheight: height))
                    wallet.restart = true
                    wallet.fullySynced = false
                } catch {
                    reject("RescanError", "Failed to rescan wallet", error)
                }
                resolve(nil)
            } else {
                reject("RescanError", "Wallet does not exist", genericError)
            }
        }
    }    

    // Memo helper

    private static func getMemo(string: String) -> Memo? {
        guard !string.isEmpty else {
            return Memo.empty
        }

        return try? Memo(string: string)
    }
    // Derivation Tool
    private func getDerivationToolForNetwork(_ network: String) -> DerivationTool {
        switch network {
        case "testnet":
            return DerivationTool(networkType:ZcashNetworkBuilder.network(for: .testnet).networkType)
        default:
            return DerivationTool(networkType:ZcashNetworkBuilder.network(for: .mainnet).networkType)
        }
    }

    @objc func deriveViewingKey(_ seed: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        let derivationTool = getDerivationToolForNetwork(network)
        if let viewingKey = try? derivationTool.deriveUnifiedSpendingKey(seed: seed.hexaBytes, accountIndex: 0).deriveFullViewingKey() {

            let out = [
                "ufvk" : viewingKey.stringEncoded
            ]

            resolve(out);
        } else {
            reject("DeriveViewingKeyError", "Failed to derive viewing key", genericError)
        }
    }

    // NOTE: Spending keys don't have an explicit encoding. they shouldn't be stored in any form. 
//
//    @objc func deriveSpendingKey(_ seed: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
//        let derivationTool = getDerivationToolForNetwork(network)
//        if let spendingKeys: [String] = try? derivationTool.deriveSpendingKeys(seed:seed.hexaBytes, numberOfAccounts:1) {
//            resolve(spendingKeys[0]);
//        } else {
//            reject("DeriveSpendingKeyError", "Failed to derive spending key", genericError)
//        }
//    }

    @objc func deriveShieldedAddress(_ alias: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {


        guard let wallet = SynchronizerMap[alias],
            let saplingAddress = wallet.synchronizer.getSaplingAddress(accountIndex: 0) else {
            reject("DeriveShieldedAddressError", "Failed to derive shielded address", genericError)
            return
        }

        resolve(saplingAddress.stringEncoded)
    }

    @objc func isValidShieldedAddress(_ address: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        let derivationTool = getDerivationToolForNetwork(network)

        resolve(derivationTool.isValidSaplingAddress(address))
    }

    @objc func isValidTransparentAddress(_ address: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        let derivationTool = getDerivationToolForNetwork(network)

        resolve(derivationTool.isValidTransparentAddress(address))
    }

    /**
     This will take care of any possible Zcash address: Sapling, Transparent or Unified
     */
    @objc func isValidZcashAddress(_ address: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {

        let network = getNetworkParams(network)

        resolve(((try? Recipient(address, network: network.networkType)) != nil))
    }
    // Events
    public func sendToJs(name: String, data: Any) {
        self.sendEvent(withName:name, body:data)
    }

    override func supportedEvents() -> [String] {
        return ["StatusEvent", "UpdateEvent"]
    }
}


class WalletSynchronizer : NSObject {
    public var alias: String
    public var synchronizer: SDKSynchronizer
    var status: String
    var emit: (String, Any) -> Void
    var fullySynced: Bool
    var restart: Bool
    var processorState: ProcessorState

    init(alias: String, initializer: Initializer, emitter:@escaping (String, Any) -> Void) throws {
        self.alias = alias
        self.synchronizer = try SDKSynchronizer(initializer:initializer)
        self.status = "DISCONNECTED"
        self.emit = emitter
        self.fullySynced = false
        self.restart = false
        self.processorState = ProcessorState(
            alias:self.alias,
            lastDownloadedHeight:0,
            lastScannedHeight:0,
            scanProgress:0,
            networkBlockHeight:0
        )
    }

    public func subscribe() {
        // Processor status
        NotificationCenter.default.addObserver(self, selector: #selector(updateProcessorState(notification:)), name: nil, object: self.synchronizer.blockProcessor)
        // Synchronizer Status
        NotificationCenter.default.addObserver(self, selector: #selector(updateSyncStatus(notification:)), name: .synchronizerDisconnected, object: self.synchronizer)
        NotificationCenter.default.addObserver(self, selector: #selector(updateSyncStatus(notification:)), name: .synchronizerStopped, object: self.synchronizer)
        NotificationCenter.default.addObserver(self, selector: #selector(updateSyncStatus(notification:)), name: .synchronizerSynced, object: self.synchronizer)
        NotificationCenter.default.addObserver(self, selector: #selector(updateSyncStatus(notification:)), name: .synchronizerDownloading, object: self.synchronizer)
        NotificationCenter.default.addObserver(self, selector: #selector(updateSyncStatus(notification:)), name: .synchronizerValidating, object: self.synchronizer)
        NotificationCenter.default.addObserver(self, selector: #selector(updateSyncStatus(notification:)), name: .synchronizerScanning, object: self.synchronizer)
        NotificationCenter.default.addObserver(self, selector: #selector(updateSyncStatus(notification:)), name: .synchronizerEnhancing, object: self.synchronizer)
    }

    @objc public func updateSyncStatus(notification: NSNotification) {
        if !self.fullySynced {
            switch notification.name.rawValue {
            case "SDKSyncronizerStopped":
                self.status = "STOPPED"
            if (self.restart == true) {
                try! self.synchronizer.start()
                initializeProcessorState()
                self.restart = false
            }
            case "SDKSyncronizerDisconnected":
                self.status = "DISCONNECTED"
            case "SDKSyncronizerDownloading":
                self.status = "DOWNLOADING"
            case "SDKSyncronizerScanning":
                if (self.processorState.scanProgress < 100) {
                    self.status = "SCANNING"
                } else {
                    self.status = "SYNCED"
                }
            case "SDKSyncronizerSynced":
                self.status = "SYNCED"
                self.fullySynced = true
            default:
                break
            }

            let data: NSDictionary = ["alias": self.alias, "name":self.status]
            emit("StatusEvent", data)
        }
    }
    
    @objc public func updateProcessorState(notification: NSNotification) {
        let prevLastDownloadedHeight = self.processorState.lastDownloadedHeight
        let prevScanProgress = self.processorState.scanProgress
        let prevLastScannedHeight = self.synchronizer.latestScannedHeight
        let prevNetworkBlockHeight = self.processorState.lastScannedHeight

        if !self.fullySynced {
            switch self.synchronizer.status {
            case .downloading(let status):
                // The SDK emits all zero values just before emitting a SYNCED status so we need to ignore these
                if status.targetHeight == 0 {
                    return
                }
                self.processorState.lastDownloadedHeight = status.progressHeight
                self.processorState.networkBlockHeight = status.targetHeight
                break
            case .scanning(let status):
                self.processorState.scanProgress = Int(floor(status.progress * 100))
                self.processorState.lastScannedHeight = status.progressHeight
                self.processorState.networkBlockHeight = status.targetHeight
            default:
                return
            }
        } else {
            self.processorState.lastDownloadedHeight = self.synchronizer.latestScannedHeight
            self.processorState.scanProgress = 100
            self.processorState.lastScannedHeight = self.synchronizer.latestScannedHeight

            self.processorState.networkBlockHeight = self.synchronizer.lastState.value.latestScannedHeight
        }

        if self.processorState.lastDownloadedHeight != prevLastDownloadedHeight || self.processorState.scanProgress != prevScanProgress ||
            self.processorState.lastScannedHeight != prevLastScannedHeight ||
            self.processorState.networkBlockHeight != prevNetworkBlockHeight {
            emit("UpdateEvent", self.processorState.nsDictionary)
        }
    }

    func initializeProcessorState() {
        self.processorState = ProcessorState(
            alias:self.alias,
            lastDownloadedHeight:0,
            lastScannedHeight:0,
            scanProgress:0,
            networkBlockHeight:0
        )
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

func z_hexEncodedString(data: Data) -> String {
    let hexDigits = Array("0123456789abcdef".utf16)
    var chars: [unichar] = []

    chars.reserveCapacity(2 * data.count)
    for byte in data {
        chars.append(hexDigits[Int(byte / 16)])
        chars.append(hexDigits[Int(byte % 16)])
    }

    return String(utf16CodeUnits: chars, count: chars.count)
}

// Local file helper funcs
func documentsDirectoryHelper() throws -> URL {
    try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
}

func cacheDbURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
    try documentsDirectoryHelper()
        .appendingPathComponent(
            network.constants.defaultDbNamePrefix + alias + ZcashSDK.defaultCacheDbName,
            isDirectory: false
        )
}

func dataDbURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
    try documentsDirectoryHelper()
        .appendingPathComponent(
            network.constants.defaultDbNamePrefix + alias + ZcashSDK.defaultDataDbName,
            isDirectory: false
        )
}

func pendingDbURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
    try documentsDirectoryHelper()
        .appendingPathComponent(network.constants.defaultDbNamePrefix + alias + ZcashSDK.defaultPendingDbName)
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

