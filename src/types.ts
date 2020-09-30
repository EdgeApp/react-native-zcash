export interface WalletBalance {
  availableBalance: string
  totalBalance: string
}

export interface InitializerConfig {
  host: string
  port: number
  fullViewingKey: string
  // alias: ??
  birthdayHeight: number
}
