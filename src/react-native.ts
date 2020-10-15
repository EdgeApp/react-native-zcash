import { NativeEventEmitter, NativeModules } from 'react-native'

import {
  InitializerConfig,
  SynchronizerCallbacks,
  SynchronizerStatus,
  WalletBalance
} from './types'

const { RNZcash } = NativeModules

const snooze: Function = (ms: number) =>
  new Promise((resolve: Function) => setTimeout(resolve, ms))

type Callback = (...args: any[]) => any

export const KeyTool = {
  deriveViewingKey: async (seedBytesHex: string): Promise<string> => {
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

  constructor() {
    this.eventEmitter = new NativeEventEmitter(RNZcash)
  }

  async start(): Promise<String> {
    const result = await RNZcash.start()
    return result
  }

  async stop(): Promise<String> {
    const result = await RNZcash.stop()
    return result
  }

  async initialize(initializerConfig: InitializerConfig): Promise<void> {
    console.log(initializerConfig)
    await RNZcash.initialize(
      initializerConfig.fullViewingKey,
      initializerConfig.birthdayHeight,
      initializerConfig.alias
    )
  }

  async getLatestNetworkHeight(): Promise<number> {
    const result = await RNZcash.getLatestNetworkHeight()
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
    const result = await RNZcash.getShieldedBalance()
    return result
  }

  async getTransparentBalance(): Promise<WalletBalance> {
    await snooze(0) // Hack to make typescript happy
    return {
      availableZatoshi: '0',
      totalZatoshi: '0'
    }
  }
  // estimateFee (spendInfo: SpendInfo): string
  // sendToAddress (spendInfo: SpendInfo): void

  // getPendingTransactions (): PendingTransactions[]
  // getConfirmedTransactions (query: TransactionQuery): ZcashTransaction[]

  // Events

  subscribe(callbacks: SynchronizerCallbacks): void {
    this.setListener('BalanceEvent', callbacks.onShieldedBalanceChanged)
    this.setListener('StatusEvent', callbacks.onStatusChanged)
    this.setListener('TransactionEvent', callbacks.onTransactionsChanged)
    this.setListener('UpdateEvent', callbacks.onUpdate)
  }

  private setListener(eventName: string, callback: Callback): void {
    // TODO: track these listeners and add only one for each event type, perhaps with some kind of composite subscription
    this.eventEmitter.addListener(eventName, callback)
  }

  unsubscribe(): void {
    // TODO: can we just use some sort of composite subscription and clear that, instead
    this.eventEmitter.removeAllListeners('BalanceEvent')
    this.eventEmitter.removeAllListeners('StatusEvent')
    this.eventEmitter.removeAllListeners('TransactionEvent')
    this.eventEmitter.removeAllListeners('UpdateEvent')
  }
}

export const makeSynchronizer = async (
  initializerConfig: InitializerConfig
): Promise<Synchronizer> => {
  const synchronizer = new Synchronizer()
  await synchronizer.initialize(initializerConfig)
  return synchronizer
}
