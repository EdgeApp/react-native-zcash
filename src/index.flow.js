export interface WalletBalance {
  availableZatoshi: string;
  totalZatoshi: string;
}
export interface InitializerConfig {
  host: string;
  port: number;
  fullViewingKey: string;
  alias: string;
  birthdayHeight: number;
}
export interface SpendInfo {
  zatoshi: string;
  toAddress: string;
  memo: string;
  fromAccountIndex: number;
  spendingKey?: string;
}
export interface TransactionQuery {
  offset?: number;
  limit?: number;
  startDate?: number;
  endDate?: number;
}
export interface ZcashTransaction {
  txId: string;
  accountIndex: number;
  fee: string;
  value: string;
  direction: 'inbound' | 'outbound';
  toAddress: string;
  memo?: string;
  minedHeight: number;
  blockTime: number;
}
export type PendingTransaction = ZcashTransaction & {
  expiryHeight: number,
  cancelled: number,
  submitAttempts: number,
  errorMessage?: string,
  errorCode?: number,
  createTime: number,
  ...
}
declare export var SynchronizerStatus: {|
  +STOPPED: 0, // 0
  +DISCONNECTED: 1, // 1
  +DOWNLOADING: 2, // 2
  +VALIDATING: 3, // 3
  +SCANNING: 4, // 4
  +ENHANCING: 5, // 5
  +SYNCED: 6 // 6
|}
export interface UpdateEvent {
  isDownloading: boolean;
  isScanning: boolean;
  lastDownloadedHeight: number;
  lastScannedHeight: number;
  scanProgress: number;
  networkBlockHeight: number;
}
export interface SynchronizerCallbacks {
  onShieldedBalanceChanged(walletBalance: WalletBalance): void;
  onStatusChanged(status: $Values<typeof SynchronizerStatus>): void;
  onUpdate(event: UpdateEvent): void;
  onTransactionsChanged(count: number): void;
  onPendingTransactionUpdated(tx: PendingTransaction): void;
}
