export type Network = 'mainnet' | 'testnet'

export interface WalletBalance {
  availableZatoshi: string
  totalZatoshi: string
}

export interface InitializerConfig {
  networkName: Network
  defaultHost: string
  defaultPort: number
  mnemonicSeed: string
  alias: string
  birthdayHeight: number
}

export interface SpendInfo {
  zatoshi: string
  toAddress: string
  memo?: string
  mnemonicSeed: string
}

export interface SpendSuccess {
  txId: string
  raw: string
}

export interface SpendFailure {
  errorMessage?: string
  errorCode?: string
}

export interface SynchronizerStatus {
  alias: string
  name:
    | 'STOPPED' /** Indicates that [stop] has been called on this Synchronizer and it will no longer be used. */
    | 'DISCONNECTED' /** Indicates that this Synchronizer is disconnected from its lightwalletd server. When set, a UI element may want to turn red. */
    | 'DOWNLOADING' /** Indicates that this Synchronizer is actively downloading new blocks from the server. */
    | 'VALIDATING' /** Indicates that this Synchronizer is actively validating new blocks that were downloaded from the server. Blocks need to be verified before they are scanned. This confirms that each block is chain-sequential, thereby detecting missing blocks and reorgs. */
    | 'SCANNING' /** Indicates that this Synchronizer is actively decrypting new blocks that were downloaded from the server. */
    | 'ENHANCING' /** Indicates that this Synchronizer is actively enhancing newly scanned blocks with additional transaction details, fetched from the server. */
    | 'SYNCED' /** Indicates that this Synchronizer is fully up to date and ready for all wallet functions. When set, a UI element may want to turn green. In this state, the balance can be trusted. */
}

export interface UnifiedViewingKey {
  extfvk: string
  extpub: string
}

export interface StatusEvent {
  alias: string
  name: SynchronizerStatus
}

export interface UpdateEvent {
  alias: string
  isDownloading: boolean
  isScanning: boolean
  lastDownloadedHeight: number
  lastScannedHeight: number
  scanProgress: number // 0 - 100
  networkBlockHeight: number
}

export interface SynchronizerCallbacks {
  onStatusChanged(status: SynchronizerStatus): void
  onUpdate(event: UpdateEvent): void
}

export interface BlockRange {
  first: number
  last: number
}

export interface ConfirmedTransaction {
  rawTransactionId: string
  blockTimeInSeconds: number
  minedHeight: number
  value: string
  toAddress?: string
  memos: string[]
}

export interface Addresses {
  unifiedAddress: string
  saplingAddress: string
  transparentAddress: string
}
