export type Network = 'mainnet' | 'testnet'

export interface InitializerConfig {
  networkName: Network
  defaultHost: string
  defaultPort: number
  mnemonicSeed: string
  alias: string
  birthdayHeight: number
  newWallet: boolean
}

export interface TransferSpendInfo {
  zatoshi: string
  toAddress: string
  memo?: string
}
export interface SpendInfo extends TransferSpendInfo {
  mnemonicSeed: string
}

export interface ShieldFundsInfo {
  seed: string
  memo: string
  threshold: string
}

export interface ProposalSuccess {
  transactionCount: number
  totalFee: string
}

export interface SpendSuccess {
  txId: string
  raw: string
}

export interface SpendFailure {
  errorMessage?: string
  errorCode?: string
}

export interface UnifiedViewingKey {
  extfvk: string
  extpub: string
}

export interface BalanceEvent {
  transparentAvailableZatoshi: string
  transparentTotalZatoshi: string
  saplingAvailableZatoshi: string
  saplingTotalZatoshi: string
  orchardAvailableZatoshi: string
  orchardTotalZatoshi: string

  /** @deprecated */
  availableZatoshi: string
  totalZatoshi: string
}

export interface StatusEvent {
  alias: string
  name:
    | 'STOPPED' /** Indicates that [stop] has been called on this Synchronizer and it will no longer be used. */
    | 'DISCONNECTED' /** Indicates that this Synchronizer is disconnected from its lightwalletd server. When set, a UI element may want to turn red. */
    | 'SYNCING' /** Indicates that this Synchronizer is actively downloading and scanning new blocks */
    | 'SYNCED' /** Indicates that this Synchronizer is fully up to date and ready for all wallet functions. When set, a UI element may want to turn green. In this state, the balance can be trusted. */
}

export interface TransactionEvent {
  transactions: Transaction[]
}

export interface UpdateEvent {
  alias: string
  scanProgress: number // 0 - 100
  networkBlockHeight: number
}

export interface SynchronizerCallbacks {
  onBalanceChanged(balance: BalanceEvent): void
  onStatusChanged(status: StatusEvent): void
  onTransactionsChanged(transactions: TransactionEvent): void
  onUpdate(event: UpdateEvent): void
}

export interface BlockRange {
  first: number
  last: number
}

export interface Transaction {
  rawTransactionId: string
  raw?: string
  blockTimeInSeconds: number
  minedHeight: number
  value: string
  fee?: string
  toAddress?: string
  memos: string[]
}

/** @deprecated Renamed `Transaction` because the package can now return unconfirmed shielding transactions */
export type ConfirmedTransaction = Transaction

export interface Addresses {
  unifiedAddress: string
  saplingAddress: string
  transparentAddress: string
}
