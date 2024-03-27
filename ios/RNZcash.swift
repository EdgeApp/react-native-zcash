import Combine
import Foundation
import MnemonicSwift
import os

var SynchronizerMap = [String: WalletSynchronizer]()

struct ConfirmedTx {
  var minedHeight: Int
  var toAddress: String?
  var raw: String?
  var rawTransactionId: String
  var blockTimeInSeconds: Int
  var value: String
  var fee: String?
  var memos: [String]?
  var dictionary: [String: Any?] {
    return [
      "minedHeight": minedHeight,
      "toAddress": toAddress,
      "raw": raw,
      "rawTransactionId": rawTransactionId,
      "blockTimeInSeconds": blockTimeInSeconds,
      "value": value,
      "fee": fee,
      "memos": memos ?? [],
    ]
  }
  var nsDictionary: NSDictionary {
    return dictionary as NSDictionary
  }
}

struct TotalBalances {
  var transparentAvailableZatoshi: Zatoshi
  var transparentTotalZatoshi: Zatoshi
  var saplingAvailableZatoshi: Zatoshi
  var saplingTotalZatoshi: Zatoshi
  var dictionary: [String: Any] {
    return [
      "transparentAvailableZatoshi": String(transparentAvailableZatoshi.amount),
      "transparentTotalZatoshi": String(transparentTotalZatoshi.amount),
      "saplingAvailableZatoshi": String(saplingAvailableZatoshi.amount),
      "saplingTotalZatoshi": String(saplingTotalZatoshi.amount),
    ]
  }
  var nsDictionary: NSDictionary {
    return dictionary as NSDictionary
  }
}

struct ProcessorState {
  var scanProgress: Int
  var networkBlockHeight: Int
  var dictionary: [String: Any] {
    return [
      "scanProgress": scanProgress,
      "networkBlockHeight": networkBlockHeight,
    ]
  }
  var nsDictionary: NSDictionary {
    return dictionary as NSDictionary
  }
}

// Used when calling reject where there isn't an error object
let genericError = NSError(domain: "", code: 0)

@objc(RNZcash)
class RNZcash: RCTEventEmitter {

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

  // Synchronizer
  @objc func initialize(
    _ seed: String, _ birthdayHeight: Int, _ alias: String, _ networkName: String,
    _ defaultHost: String, _ defaultPort: Int, _ newWallet: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      let network = getNetworkParams(networkName)
      let endpoint = LightWalletEndpoint(address: defaultHost, port: defaultPort, secure: true)
      let initializer = Initializer(
        cacheDbURL: try! cacheDbURLHelper(alias, network),
        fsBlockDbRoot: try! fsBlockDbRootURLHelper(alias, network),
        generalStorageURL: try! generalStorageURLHelper(alias, network),
        dataDbURL: try! dataDbURLHelper(alias, network),
        endpoint: endpoint,
        network: network,
        spendParamsURL: try! spendParamsURLHelper(alias),
        outputParamsURL: try! outputParamsURLHelper(alias),
        saplingParamsSourceURL: SaplingParamsSourceURL.default,
        alias: ZcashSynchronizerAlias.custom(alias)
      )
      if SynchronizerMap[alias] == nil {
        do {
          let wallet = try WalletSynchronizer(
            alias: alias, initializer: initializer, emitter: sendToJs)
          let seedBytes = try Mnemonic.deterministicSeedBytes(from: seed)
          let initMode = newWallet ? WalletInitMode.newWallet : WalletInitMode.existingWallet

          _ = try await wallet.synchronizer.prepare(
            with: seedBytes,
            walletBirthday: birthdayHeight,
            for: initMode
          )
          try await wallet.synchronizer.start()
          wallet.subscribe()
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
  }

  @objc func start(
    _ alias: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      if let wallet = SynchronizerMap[alias] {
        do {
          try await wallet.synchronizer.start()
          wallet.subscribe()
        } catch {
          reject("StartError", "Synchronizer failed to start", error)
        }
        resolve(nil)
      } else {
        reject("StartError", "Wallet does not exist", genericError)
      }
    }
  }

  @objc func stop(
    _ alias: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if let wallet = SynchronizerMap[alias] {
      wallet.synchronizer.stop()
      wallet.cancellables.forEach { $0.cancel() }
      SynchronizerMap[alias] = nil
      resolve(nil)
    } else {
      reject("StopError", "Wallet does not exist", genericError)
    }
  }

  @objc func getLatestNetworkHeight(
    _ alias: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      if let wallet = SynchronizerMap[alias] {
        do {
          let height = try await wallet.synchronizer.latestHeight()
          resolve(height)
        } catch {
          reject("getLatestNetworkHeight", "Failed to query blockheight", error)
        }
      } else {
        reject("getLatestNetworkHeightError", "Wallet does not exist", genericError)
      }
    }
  }

  // A convenience method to get the block height when the synchronizer isn't running
  @objc func getBirthdayHeight(
    _ host: String, _ port: Int, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      do {
        let endpoint = LightWalletEndpoint(address: host, port: port, secure: true)
        let lightwalletd: LightWalletService = LightWalletGRPCService(endpoint: endpoint)
        let height = try await lightwalletd.latestBlockHeight()
        lightwalletd.closeConnection()
        resolve(height)
      } catch {
        reject("getLatestNetworkHeightGrpc", "Failed to query blockheight", error)
      }
    }
  }

  @objc func sendToAddress(
    _ alias: String, _ zatoshi: String, _ toAddress: String, _ memo: String, _ seed: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      if let wallet = SynchronizerMap[alias] {
        let amount = Int64(zatoshi)
        if amount == nil {
          reject("SpendToAddressError", "Amount is invalid", genericError)
          return
        }

        do {
          let spendingKey = try deriveUnifiedSpendingKey(seed, wallet.synchronizer.network)
          var sdkMemo: Memo? = nil
          if memo != "" {
            sdkMemo = try Memo(string: memo)
          }
          let broadcastTx = try await wallet.synchronizer.sendToAddress(
            spendingKey: spendingKey,
            zatoshi: Zatoshi(amount!),
            toAddress: Recipient(toAddress, network: wallet.synchronizer.network.networkType),
            memo: sdkMemo
          )

          let tx: NSMutableDictionary = ["txId": broadcastTx.rawID.toHexStringTxId()]
          if broadcastTx.raw != nil {
            tx["raw"] = broadcastTx.raw?.hexEncodedString()
          }
          resolve(tx)
        } catch {
          reject("SpendToAddressError", "Failed to spend", error)
        }
      } else {
        reject("SpendToAddressError", "Wallet does not exist", genericError)
      }
    }
  }

  @objc func shieldFunds(
    _ alias: String, _ seed: String, _ memo: String, _ threshold: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      if let wallet = SynchronizerMap[alias] {
        if !wallet.fullySynced {
          reject("shieldFunds", "Wallet is not synced", genericError)
          return
        }

        do {
          let spendingKey = try deriveUnifiedSpendingKey(seed, wallet.synchronizer.network)
          let sdkMemo = try Memo(string: memo)
          let shieldingThreshold = Int64(threshold) ?? 10000

          let tx = try await wallet.synchronizer.shieldFunds(
            spendingKey: spendingKey,
            memo: sdkMemo,
            shieldingThreshold: Zatoshi(shieldingThreshold)
          )

          var confTx = await wallet.parseTx(tx: tx)

          // Hack: Memos aren't ready to be queried right after broadcast
          confTx.memos = [memo]
          resolve(confTx.nsDictionary)
        } catch {
          reject("shieldFunds", "Failed to shield funds", genericError)
        }
      } else {
        reject("shieldFunds", "Wallet does not exist", genericError)
      }
    }
  }

  @objc func rescan(
    _ alias: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      if let wallet = SynchronizerMap[alias] {
        wallet.synchronizer.rewind(.birthday).sink(
          receiveCompletion: { completion in
            Task {
              switch completion {
              case .finished:
                wallet.status = "STOPPED"
                wallet.fullySynced = false
                wallet.restart = true
                wallet.initializeProcessorState()
                wallet.cancellables.forEach { $0.cancel() }
                try await wallet.synchronizer.start()
                wallet.subscribe()
                resolve(nil)
              case .failure:
                reject("RescanError", "Failed to rescan wallet", genericError)
              }
            }
          }, receiveValue: { _ in }
        ).store(in: &wallet.cancellables)
      } else {
        reject("RescanError", "Wallet does not exist", genericError)
      }
    }
  }

  // Derivation Tool
  private func getDerivationToolForNetwork(_ network: String) -> DerivationTool {
    switch network {
    case "testnet":
      return DerivationTool(networkType: ZcashNetworkBuilder.network(for: .testnet).networkType)
    default:
      return DerivationTool(networkType: ZcashNetworkBuilder.network(for: .mainnet).networkType)
    }
  }

  private func deriveUnifiedSpendingKey(_ seed: String, _ network: ZcashNetwork) throws
    -> UnifiedSpendingKey
  {
    let derivationTool = DerivationTool(networkType: network.networkType)
    let seedBytes = try Mnemonic.deterministicSeedBytes(from: seed)
    let spendingKey = try derivationTool.deriveUnifiedSpendingKey(seed: seedBytes, accountIndex: 0)
    return spendingKey
  }

  private func deriveUnifiedViewingKey(_ seed: String, _ network: ZcashNetwork) throws
    -> UnifiedFullViewingKey
  {
    let spendingKey = try deriveUnifiedSpendingKey(seed, network)
    let derivationTool = DerivationTool(networkType: network.networkType)
    let viewingKey = try derivationTool.deriveUnifiedFullViewingKey(from: spendingKey)
    return viewingKey
  }

  @objc func deriveViewingKey(
    _ seed: String, _ network: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let zcashNetwork = getNetworkParams(network)
      let viewingKey = try deriveUnifiedViewingKey(seed, zcashNetwork)
      resolve(viewingKey.stringEncoded)
    } catch {
      reject("DeriveViewingKeyError", "Failed to derive viewing key", error)
    }
  }

  @objc func deriveUnifiedAddress(
    _ alias: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      if let wallet = SynchronizerMap[alias] {
        do {
          let unifiedAddress = try await wallet.synchronizer.getUnifiedAddress(accountIndex: 0)
          let saplingAddress = try await wallet.synchronizer.getSaplingAddress(accountIndex: 0)
          let transparentAddress = try await wallet.synchronizer.getTransparentAddress(
            accountIndex: 0)
          let addresses: NSDictionary = [
            "unifiedAddress": unifiedAddress.stringEncoded,
            "saplingAddress": saplingAddress.stringEncoded,
            "transparentAddress": transparentAddress.stringEncoded,
          ]
          resolve(addresses)
          return
        } catch {
          reject("deriveUnifiedAddress", "Failed to derive unified address", error)
        }
      } else {
        reject("deriveUnifiedAddress", "Wallet does not exist", genericError)
      }
    }
  }

  @objc func isValidAddress(
    _ address: String, _ network: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let derivationTool = getDerivationToolForNetwork(network)
    if derivationTool.isValidUnifiedAddress(address)
      || derivationTool.isValidSaplingAddress(address)
      || derivationTool.isValidTransparentAddress(address)
    {
      resolve(true)
    } else {
      resolve(false)
    }
  }

  // Events
  public func sendToJs(name: String, data: Any) {
    self.sendEvent(withName: name, body: data)
  }

  override func supportedEvents() -> [String] {
    return ["BalanceEvent", "StatusEvent", "TransactionEvent", "UpdateEvent"]
  }
}

class WalletSynchronizer: NSObject {
  public var alias: String
  public var synchronizer: SDKSynchronizer
  var status: String
  var emit: (String, Any) -> Void
  var fullySynced: Bool
  var restart: Bool
  var processorState: ProcessorState
  var cancellables: [AnyCancellable] = []
  var balances: TotalBalances

  init(alias: String, initializer: Initializer, emitter: @escaping (String, Any) -> Void) throws {
    self.alias = alias
    self.synchronizer = SDKSynchronizer(initializer: initializer)
    self.status = "STOPPED"
    self.emit = emitter
    self.fullySynced = false
    self.restart = false
    self.processorState = ProcessorState(
      scanProgress: 0,
      networkBlockHeight: 0
    )
    self.balances = TotalBalances(
      transparentAvailableZatoshi: Zatoshi(0),
      transparentTotalZatoshi: Zatoshi(0),
      saplingAvailableZatoshi: Zatoshi(0),
      saplingTotalZatoshi: Zatoshi(0))
  }

  public func subscribe() {
    self.synchronizer.stateStream
      .sink(receiveValue: { [weak self] state in self?.updateSyncStatus(event: state) })
      .store(in: &cancellables)
    self.synchronizer.stateStream
      .sink(receiveValue: { [weak self] state in self?.updateProcessorState(event: state) })
      .store(in: &cancellables)
    self.synchronizer.eventStream
      .sink { SynchronizerEvent in
        switch SynchronizerEvent {
        case .minedTransaction(let transaction):
          self.emitTxs(transactions: [transaction])
        case .foundTransactions(let transactions, _):
          self.emitTxs(transactions: transactions)
        default:
          return
        }
      }
      .store(in: &cancellables)
  }

  func updateSyncStatus(event: SynchronizerState) {
    var status = self.status

    if !self.fullySynced {
      switch event.internalSyncStatus {
      case .syncing:
        status = "SYNCING"
        self.restart = false
      case .synced:
        if self.restart {
          // The synchronizer emits "synced" status after starting a rescan. We need to ignore these.
          return
        }
        status = "SYNCED"

        self.fullySynced = true
      default:
        break
      }

      if status == self.status { return }
      self.status = status
      let data: NSDictionary = ["alias": self.alias, "name": self.status]
      emit("StatusEvent", data)
    }
  }

  func updateProcessorState(event: SynchronizerState) {
    var scanProgress = 0

    switch event.internalSyncStatus {
    case .syncing(let progress):
      scanProgress = Int(floor(progress * 100))
    case .synced:
      scanProgress = 100
    case .unprepared, .disconnected, .stopped:
      scanProgress = 0
    default:
      return
    }

    if scanProgress == self.processorState.scanProgress
      && event.latestBlockHeight == self.processorState.networkBlockHeight
    {
      return
    }

    self.processorState = ProcessorState(
      scanProgress: scanProgress, networkBlockHeight: event.latestBlockHeight)
    let data: NSDictionary = [
      "alias": self.alias, "scanProgress": self.processorState.scanProgress,
      "networkBlockHeight": self.processorState.networkBlockHeight,
    ]
    emit("UpdateEvent", data)
    updateBalanceState(event: event)
  }

  func initializeProcessorState() {
    self.processorState = ProcessorState(
      scanProgress: 0,
      networkBlockHeight: 0
    )
    self.balances = TotalBalances(
      transparentAvailableZatoshi: Zatoshi(0),
      transparentTotalZatoshi: Zatoshi(0),
      saplingAvailableZatoshi: Zatoshi(0),
      saplingTotalZatoshi: Zatoshi(0))
  }

  func updateBalanceState(event: SynchronizerState) {
    let transparentBalance = event.transparentBalance
    let shieldedBalance = event.shieldedBalance

    let transparentAvailableZatoshi = transparentBalance.verified
    let transparentTotalZatoshi = transparentBalance.total

    let saplingAvailableZatoshi = shieldedBalance.verified
    let saplingTotalZatoshi = shieldedBalance.total

    self.balances = TotalBalances(
      transparentAvailableZatoshi: transparentAvailableZatoshi,
      transparentTotalZatoshi: transparentTotalZatoshi,
      saplingAvailableZatoshi: saplingAvailableZatoshi,
      saplingTotalZatoshi: saplingTotalZatoshi
    )
    let data = NSMutableDictionary(dictionary: self.balances.nsDictionary)
    data["alias"] = self.alias
    emit("BalanceEvent", data)
  }

  func parseTx(tx: ZcashTransaction.Overview) async -> ConfirmedTx {
    var confTx = ConfirmedTx(
      minedHeight: tx.minedHeight ?? 0,
      rawTransactionId: (tx.rawID.toHexStringTxId()),
      blockTimeInSeconds: Int(tx.blockTime ?? 0),
      value: String(describing: abs(tx.value.amount))
    )
    if tx.raw != nil {
      confTx.raw = tx.raw!.hexEncodedString()
    }
    if tx.fee != nil {
      confTx.fee = String(describing: abs(tx.fee!.amount))
    }
    if tx.isSentTransaction {
      let recipients = await self.synchronizer.getRecipients(for: tx)
      if recipients.count > 0 {
        let addresses = recipients.compactMap {
          if case let .address(address) = $0 {
            return address
          } else {
            return nil
          }
        }
        if addresses.count > 0 {
          confTx.toAddress = addresses.first!.stringEncoded
        }
      }
    }
    if tx.memoCount > 0 {
      let memos = (try? await self.synchronizer.getMemos(for: tx)) ?? []
      let textMemos = memos.compactMap {
        return $0.toString()
      }
      confTx.memos = textMemos
    }
    return confTx
  }

  func emitTxs(transactions: [ZcashTransaction.Overview]) {
    Task {
      var out: [NSDictionary] = []
      for tx in transactions {
        if tx.isExpiredUmined ?? false { continue }
        let confTx = await parseTx(tx: tx)
        out.append(confTx.nsDictionary)
      }

      let data: NSDictionary = ["alias": self.alias, "transactions": NSArray(array: out)]
      emit("TransactionEvent", data)
    }
  }
}

// Local file helper funcs
func documentsDirectoryHelper() throws -> URL {
  try FileManager.default.url(
    for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
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

func spendParamsURLHelper(_ alias: String) throws -> URL {
  try documentsDirectoryHelper().appendingPathComponent(alias + "sapling-spend.params")
}

func outputParamsURLHelper(_ alias: String) throws -> URL {
  try documentsDirectoryHelper().appendingPathComponent(alias + "sapling-output.params")
}

func fsBlockDbRootURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
  try documentsDirectoryHelper()
    .appendingPathComponent(
      network.constants.defaultDbNamePrefix + alias + ZcashSDK.defaultFsCacheName,
      isDirectory: true
    )
}

func generalStorageURLHelper(_ alias: String, _ network: ZcashNetwork) throws -> URL {
  try documentsDirectoryHelper()
    .appendingPathComponent(
      network.constants.defaultDbNamePrefix + alias + "general_storage",
      isDirectory: true
    )
}
