export type Network = 'mainnet' | 'testnet'

export interface WalletBalance {
  availableZatoshi: string
  totalZatoshi: string
}

export interface InitializerConfig {
  networkName: Network
  defaultHost: string
  defaultPort: number
  fullViewingKey: UnifiedViewingKey
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
  expiryHeight: number
  cancelled: number
  submitAttempts: number
  errorMessage?: string
  errorCode?: number
  createTime: number
}

export enum SynchronizerStatus {
  /** Indicates that [stop] has been called on this Synchronizer and it will no longer be used. */
  STOPPED,
  /** Indicates that this Synchronizer is disconnected from its lightwalletd server. When set, a UI element may want to turn red. */
  DISCONNECTED,
  /** Indicates that this Synchronizer is actively downloading new blocks from the server. */
  DOWNLOADING,
  /** Indicates that this Synchronizer is actively validating new blocks that were downloaded from the server. Blocks need to be verified before they are scanned. This confirms that each block is chain-sequential, thereby detecting missing blocks and reorgs. */
  VALIDATING,
  /** Indicates that this Synchronizer is actively decrypting new blocks that were downloaded from the server. */
  SCANNING,
  /** Indicates that this Synchronizer is actively enhancing newly scanned blocks with additional transaction details, fetched from the server. */
  ENHANCING,
  /** Indicates that this Synchronizer is fully up to date and ready for all wallet functions. When set, a UI element may want to turn green. In this state, the balance can be trusted. */
  SYNCED
}

export interface UnifiedViewingKey {
  extfvk: string
  extpub: string
}

export interface UpdateEvent {
  isDownloading: boolean
  isScanning: boolean
  lastDownloadedHeight: number
  lastScannedHeight: number
  scanProgress: number // 0 - 100
  networkBlockHeight: number
}

export interface SynchronizerCallbacks {
  onShieldedBalanceChanged(walletBalance: WalletBalance): void
  onStatusChanged(status: SynchronizerStatus): void
  onUpdate(event: UpdateEvent): void
  onTransactionsChanged(count: number): void
  onPendingTransactionUpdated(tx: PendingTransaction): void
}

export interface BlockRange {
  first: number
  last: number
}

export interface ConfirmedTransaction {
  value: string
  memo?: string
  minedHeight: number
  rawTransactionId: string
  toAddress?: string
}
