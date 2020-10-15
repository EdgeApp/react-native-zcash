import { NativeEventEmitter, NativeModules } from 'react-native'

import { InitializerConfig, WalletBalance } from './types'

const { RNZcash } = NativeModules

const snooze: Function = (ms: number) =>
  new Promise((resolve: Function) => setTimeout(resolve, ms))

type Callback = (...args: any[]) => any

// export function subscribeToFoo(callback: Callback): void {
//   const eventEmitter = new NativeEventEmitter(RNZcash)
//   eventEmitter.addListener('FooEvent', callback)
// }

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
// const makeAddressTool = () => {
//   return {
//     deriveShieldedAddress: async (viewingKey: string): Promise<string> => {return ''},
//     deriveTransparentAddress: async (viewingKey: string): Promise<string> => {return ''},
//     isValidShieldedAddress: async (address: string): Promise<boolean> => {return true},
//     isValidTransparentAddress: async (address: string): Promise<boolean> => {return true}
//   }
// }
//
// interface WalletBalance {
//   shieldedAvailable: string
//   shieldedTotal: string
//   transparentAvailable: string
//   transparentTotal: string
// }
// interface InitializerCallbacks {
//   onError: (e: Error): void
//   onTransactionsChanged: (): void
//   onBalanceChanged: (walletBalance: WalletBalance): void
// }
// interface SpendInfo {
//   zatoshi: string
//   toAddress: string
//   memo: string
//   fromAccountIndex: number
//   spendingKey?: string
// }

// interface ZcashTransaction {
//   txId: string
//   fee: string
//   value: string
//   direction: 'inbound' | 'outbound'
//   toAddress: string
//   memo?: string
//   minedHeight: number // 0 for unconfirmed
//   blockTime: number // UNIX timestamp
// }
// type PendingTransaction = ZcashTransaction & {
//   accountIndex: number
//   expiryHeight: number
//   cancelled: number
//   submitAttempts: number
//   errorMessage?: string
//   errorCode?: number
//   createTime: number
// }

// interface TransactionQuery {
//   offset?: number
//   limit?: number
//   startDate?: number
//   endDate?: number
// }
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

  // static init (initializerConfig: InitializerConfig): void
  // setCallbackHandlers (callbacks: InitializerCallbacks): void
  // getLatestHeight (): number
  // getProgress (): number // 0-1
  // getStatus (): ??
  async getShieldedBalance(): Promise<WalletBalance> {
    const result = await RNZcash.getShieldedBalance()
    return result
  }

  async getTransparentBalance(): Promise<WalletBalance> {
    await snooze(0) // Hack to make typescript happy
    return {
      availableBalance: '0',
      totalBalance: '0'
    }
  }
  // estimateFee (spendInfo: SpendInfo): string
  // sendToAddress (spendInfo: SpendInfo): void
  // start (): void
  // stop (): void
  // getPendingTransactions (): PendingTransactions[]
  // getConfirmedTransactions (query: TransactionQuery): ZcashTransaction[]

  // Events

  subscribeToUpdates(callback: Callback): void {
    this.setListener('UpdateEvent', callback)
  }

  subscribeToStatus(callback: Callback): void {
    this.setListener('StatusEvent', callback)
  }

  subscribeToBalance(callback: Callback): void {
    this.setListener('BalanceEvent', callback)
  }

  subscribeToTransactions(callback: Callback): void {
    this.setListener('TransactionEvent', callback)
  }

  private setListener(eventName: string, callback: Callback): void {
    // TODO: track these listeners and add only one for each event type
    this.eventEmitter.addListener(eventName, callback)
  }

  unsubscribe(): void {
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
