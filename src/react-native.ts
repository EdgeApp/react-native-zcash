import { NativeModules } from 'react-native'

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
  deriveViewKey: async (seedBytesHex: string): Promise<string> => {
    const result = await RNZcash.deriveViewKey(seedBytesHex)
    return result
  }
  // deriveSpendingKey: async (seedBytesHex: string): Promise<string> => {return ''}
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
//   submitAttemps: number
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
  constructor(initializerConfig: InitializerConfig) {
    console.log(initializerConfig)
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
}

export const makeSynchronizer = async (
  initializerConfig: InitializerConfig
): Promise<Synchronizer> => {
  await snooze(0) // Hack to make typescript happy
  return new Synchronizer(initializerConfig)
}
