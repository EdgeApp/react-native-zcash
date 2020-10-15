export interface WalletBalance {
  available: string
  total: string
}

export interface InitializerConfig {
  host: string
  port: number
  fullViewingKey: string
  alias: string
  birthdayHeight: number
}

export interface SpendInfo {
  zatoshi: string
  toAddress: string
  memo: string
  fromAccountIndex: number
  spendingKey?: string
}

export interface TransactionQuery {
  offset?: number
  limit?: number
  startDate?: number
  endDate?: number
}

export interface ZcashTransaction {
  txId: string
  accountIndex: number
  fee: string
  value: string
  direction: 'inbound' | 'outbound'
  toAddress: string
  memo?: string
  minedHeight: number // 0 for unconfirmed
  blockTime: number // UNIX timestamp
}

export type PendingTransaction = ZcashTransaction & {
  accountIndex: number
  expiryHeight: number
  cancelled: number
  submitAttempts: number
  errorMessage?: string
  errorCode?: number
  createTime: number
}
