import {
  EventSubscription,
  NativeEventEmitter,
  NativeModules
} from 'react-native'

import {
  BlockRange,
  ConfirmedTransaction,
  InitializerConfig,
  PendingTransaction,
  SpendInfo,
  SynchronizerCallbacks,
  SynchronizerStatus,
  UnifiedViewingKey,
  WalletBalance
} from './types'

const { RNZcash } = NativeModules

const snooze: Function = (ms: number) =>
  new Promise((resolve: Function) => setTimeout(resolve, ms))

type Callback = (...args: any[]) => any

export const KeyTool = {
  deriveViewingKey: async (
    seedBytesHex: string
  ): Promise<UnifiedViewingKey> => {
    const result = await RNZcash.deriveViewingKey(seedBytesHex)
    return result
  },
  deriveSpendingKey: async (seedBytesHex: string): Promise<string> => {
    const result = await RNZcash.deriveSpendingKey(seedBytesHex)
    return result
  }
}

export const AddressTool = {
  deriveShieldedAddress: async (viewingKey: string): Promise<string> => {
    const result = await RNZcash.deriveShieldedAddress(viewingKey)
    return result
  },
  deriveTransparentAddress: async (seedHex: string): Promise<string> => {
    const result = await RNZcash.deriveTransparentAddress(seedHex)
    return result
  },
  isValidShieldedAddress: async (address: string): Promise<boolean> => {
    const result = await RNZcash.isValidShieldedAddress(address)
    return result
  },
  isValidTransparentAddress: async (address: string): Promise<boolean> => {
    const result = await RNZcash.isValidTransparentAddress(address)
    return result
  }
}

class Synchronizer {
  eventEmitter: NativeEventEmitter
  subscriptions: EventSubscription[]
  alias: string

  constructor(alias: string) {
    this.eventEmitter = new NativeEventEmitter(RNZcash)
    this.subscriptions = []
    this.alias = alias
  }

  /// ////////////////////////////////////////////////////////////////
  // Start PoC behavior
  //     Here are a few functions to demonstrate functionality but the final library should not have these functions
  //
  async readyToSend(): Promise<boolean> {
    const result = await RNZcash.readyToSend()
    return result
  }

  async sendTestTransaction(
    key: string,
    address: string
  ): Promise<PendingTransaction> {
    // send an amount that's guaranteed to be too large for our wallet and expect it to fail but at least show how this is done
    // simply change these two values to send a real transaction but ensure the function isn't called too often (although funds can't be spent if notes are unconfirmed)
    const invalidValue = '9223372036854775807' // Max long value (change this to 10000 to send a small transaction equal to the miner's fee on every reload and you could send 10,000 of those before it equals 1 ZEC)
    const invalidAccount = 99 // should be 0
    return this.sendToAddress({
      zatoshi: invalidValue,
      toAddress: address,
      memo: 'this is a test transaction that will fail',
      fromAccountIndex: invalidAccount,
      spendingKey: key
    })
  }

  async getBlockCount(): Promise<number> {
    const result = await RNZcash.getBlockCount()
    return result
  }
  // End PoC behavior
  /// ////////////////////////////////////////////////////////////////

  async start(): Promise<String> {
    const result = await RNZcash.start(this.alias)
    return result
  }

  async stop(): Promise<String> {
    this.unsubscribe()
    const result = await RNZcash.stop(this.alias)
    return result
  }

  async initialize(initializerConfig: InitializerConfig): Promise<void> {
    await RNZcash.initialize(
      initializerConfig.fullViewingKey.extfvk,
      initializerConfig.fullViewingKey.extpub,
      initializerConfig.birthdayHeight,
      initializerConfig.alias,
      initializerConfig.networkName,
      initializerConfig.defaultHost,
      initializerConfig.defaultPort
    )
  }

  async getLatestNetworkHeight(alias: string): Promise<number> {
    const result = await RNZcash.getLatestNetworkHeight(alias)
    return result
  }

  async getLatestScannedHeight(): Promise<number> {
    const result = await RNZcash.getLatestScannedHeight()
    return result
  }

  async getProgress(): Promise<number> {
    const result = await RNZcash.getProgress()
    return result
  }

  async getStatus(): Promise<SynchronizerStatus> {
    const result = await RNZcash.getStatus()
    return SynchronizerStatus[result.name as keyof typeof SynchronizerStatus]
  }

  async getShieldedBalance(): Promise<WalletBalance> {
    const result = await RNZcash.getShieldedBalance(this.alias)
    return result
  }

  async getTransparentBalance(): Promise<WalletBalance> {
    // TODO: integrate with lightwalletd service to provide taddr balance. Edge probably doesn't need this, though so it can wait.

    await snooze(0) // Hack to make typescript happy
    return {
      availableZatoshi: '0',
      totalZatoshi: '0'
    }
  }

  async getTransactions(range: BlockRange): Promise<ConfirmedTransaction[]> {
    const result = await RNZcash.getTransactions(
      this.alias,
      range.first,
      range.last
    )
    return result
  }

  rescan(height: number): void {
    RNZcash.rescan(this.alias, height)
  }

  async sendToAddress(spendInfo: SpendInfo): Promise<PendingTransaction> {
    const result = await RNZcash.spendToAddress(
      this.alias,
      spendInfo.zatoshi,
      spendInfo.toAddress,
      spendInfo.memo,
      spendInfo.fromAccountIndex,
      // TODO: ask is it okay to send this across the boundary or should it live on the native side and never leave?
      spendInfo.spendingKey
    )
    return result
  }

  // estimateFee (spendInfo: SpendInfo): string
  // sendToAddress (spendInfo: SpendInfo): void

  // getPendingTransactions (): PendingTransactions[]
  // getConfirmedTransactions (query: TransactionQuery): ZcashTransaction[]

  // Events

  subscribe({
    onShieldedBalanceChanged,
    onStatusChanged,
    onTransactionsChanged,
    onUpdate,
    onPendingTransactionUpdated
  }: SynchronizerCallbacks): void {
    this.setListener('BalanceEvent', onShieldedBalanceChanged)
    this.setListener('StatusEvent', onStatusChanged)
    this.setListener('TransactionEvent', onTransactionsChanged)
    this.setListener('UpdateEvent', onUpdate)
    this.setListener('PendingTransactionUpdated', onPendingTransactionUpdated)
  }

  private setListener<T>(
    eventName: string,
    callback: Callback = (t: any) => null
  ): void {
    this.subscriptions.push(
      this.eventEmitter.addListener(eventName, arg =>
        arg.alias === this.alias ? callback(arg) : null
      )
    )
  }

  unsubscribe(): void {
    this.subscriptions.forEach(subscription => {
      subscription.remove()
    })
  }
}

export const makeSynchronizer = async (
  initializerConfig: InitializerConfig
): Promise<Synchronizer> => {
  const synchronizer = new Synchronizer(initializerConfig.alias)
  await synchronizer.initialize(initializerConfig)
  return synchronizer
}
