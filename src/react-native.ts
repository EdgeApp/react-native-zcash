import { add } from 'biggystring'
import {
  EventSubscription,
  NativeEventEmitter,
  NativeModules
} from 'react-native'

import {
  Addresses,
  CreateTransferOpts,
  ImmediateMigrationProposal,
  InitializerConfig,
  Network,
  ProposalSuccess,
  ProposeTransferOpts,
  ShieldFundsInfo,
  SpendFailure,
  SpendSuccess,
  SynchronizerCallbacks
} from './types'
export * from './types'

const { RNZcash } = NativeModules

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return { errorMessage: value }
  }
}

/**
 * JSON with each object's keys in sorted order. The native bridge does not
 * keep key order stable between calls, so equal payloads can serialize
 * differently under plain JSON.stringify.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner == null || typeof inner !== 'object' || Array.isArray(inner)) {
      return inner
    }
    const record = inner as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
      sorted[key] = record[key]
    }
    return sorted
  })
}

export const Tools = {
  deriveViewingKey: async (
    seedBytesHex: string,
    network: Network
  ): Promise<string> => {
    const result = await RNZcash.deriveViewingKey(seedBytesHex, network)
    return result
  },
  getBirthdayHeight: async (host: string, port: number): Promise<number> => {
    const result = await RNZcash.getBirthdayHeight(host, port)
    return result
  },
  isValidAddress: async (
    address: string,
    network: Network = 'mainnet'
  ): Promise<boolean> => {
    const result = await RNZcash.isValidAddress(address, network)
    return result
  },
  /**
   * The NU6.3 (Ironwood) activation height for the network, or null when the
   * network has none. Stateless, so it is safe to call before any
   * synchronizer exists; the app gates migration UI on the chain reaching
   * this height. The heights are consensus constants (ZIP 258).
   */
  getIronwoodActivationHeight: async (
    network: Network = 'mainnet'
  ): Promise<number | null> => {
    const result = await RNZcash.ironwoodActivationHeight(network)
    return result
  }
}

export class Synchronizer {
  eventEmitter: NativeEventEmitter
  subscriptions: EventSubscription[]
  alias: string
  network: Network
  private timer?: ReturnType<typeof setTimeout>
  private callbacks?: SynchronizerCallbacks
  private lastStatus?: string
  private lastBalancesJson?: string
  private lastTransactionsJson?: string

  constructor(alias: string, network: Network) {
    this.eventEmitter = new NativeEventEmitter(RNZcash)
    this.subscriptions = []
    this.alias = alias
    this.network = network
  }

  async stop(): Promise<string> {
    this.unsubscribe()
    const result = await RNZcash.stop(this.alias)
    return result
  }

  async initialize(initializerConfig: InitializerConfig): Promise<void> {
    await RNZcash.initialize(
      initializerConfig.mnemonicSeed,
      initializerConfig.birthdayHeight,
      initializerConfig.alias,
      initializerConfig.networkName,
      initializerConfig.defaultHost,
      initializerConfig.defaultPort,
      initializerConfig.newWallet
    )
  }

  async deriveUnifiedAddress(): Promise<Addresses> {
    const result = await RNZcash.deriveUnifiedAddress(this.alias)
    return result
  }

  async getLatestNetworkHeight(alias: string): Promise<number> {
    const result = await RNZcash.getLatestNetworkHeight(alias)
    return result
  }

  async rescan(): Promise<void> {
    await RNZcash.rescan(this.alias)
  }

  /**
   * Proposes the Orchard-only sweep to the wallet's own address. Execute the
   * returned proposal through the ordinary createTransfer path.
   */
  async proposeOrchardToIronwoodMigration(): Promise<
    ImmediateMigrationProposal
  > {
    const result = await RNZcash.proposeOrchardToIronwoodMigration(this.alias)
    return parseJsonObject(result) as ImmediateMigrationProposal
  }

  async proposeTransfer(opts: ProposeTransferOpts): Promise<ProposalSuccess> {
    const result = await RNZcash.proposeTransfer(
      this.alias,
      opts.zatoshi,
      opts.toAddress,
      opts.memo
    )
    return parseJsonObject(result) as ProposalSuccess
  }

  async proposeFulfillingPaymentURI(
    paymentUri: string
  ): Promise<ProposalSuccess> {
    const result = await RNZcash.proposeFulfillingPaymentURI(
      this.alias,
      paymentUri
    )
    return parseJsonObject(result) as ProposalSuccess
  }

  async createTransfer(
    opts: CreateTransferOpts
  ): Promise<string | SpendFailure> {
    try {
      const result = await RNZcash.createTransfer(
        this.alias,
        opts.proposalBase64,
        opts.mnemonicSeed
      )
      const spend = parseJsonObject(result) as SpendSuccess
      // The Ironwood migration transmits while it signs and returns no raw
      // transaction, so only an ordinary transfer is broadcast here.
      if (spend.raw === '') return spend.txId
      return await RNZcash.broadcastTransfer(this.alias, spend.txId)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { errorMessage }
    }
  }

  async shieldFunds(shieldFundsInfo: ShieldFundsInfo): Promise<string> {
    const result = await RNZcash.shieldFunds(
      this.alias,
      shieldFundsInfo.seed,
      shieldFundsInfo.memo,
      shieldFundsInfo.threshold
    )
    return result
  }

  subscribe({
    onBalanceChanged,
    onStatusChanged,
    onTransactionsChanged,
    onUpdate,
    onError
  }: SynchronizerCallbacks): void {
    this.callbacks = {
      onBalanceChanged,
      onStatusChanged,
      onTransactionsChanged,
      onUpdate,
      onError
    }
    this.pumpAndReschedule()
  }

  unsubscribe(): void {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.callbacks = undefined
    this.lastStatus = undefined
    this.lastBalancesJson = undefined
    this.lastTransactionsJson = undefined
    this.subscriptions.forEach(subscription => {
      subscription.remove()
    })
    this.subscriptions = []
  }

  /**
   * Polls once, then schedules the next poll, sooner while syncing. A failed
   * poll is reported and retried on the slower cadence.
   */
  private pumpAndReschedule(): void {
    this.pump().then(
      status => {
        this.scheduleNextPump(status === 'SYNCING')
      },
      (error: unknown) => {
        this.callbacks?.onError({
          alias: this.alias,
          level: 'error',
          message: `event pump failed: ${String(error)}`
        })
        this.scheduleNextPump(false)
      }
    )
  }

  private scheduleNextPump(syncing: boolean): void {
    if (this.callbacks == null) return
    this.timer = setTimeout(
      () => {
        this.pumpAndReschedule()
      },
      syncing ? 500 : 2000
    )
  }

  /**
   * Delivers one poll to the callbacks. Balances and transactions go out
   * only when they differ from the last delivery, since each crosses the
   * bridge in full.
   */
  private async pump(): Promise<string | undefined> {
    if (this.callbacks == null) return
    const snap = await RNZcash.poll(this.alias)
    if (this.callbacks == null) return
    const {
      onBalanceChanged,
      onStatusChanged,
      onTransactionsChanged,
      onUpdate
    } = this.callbacks

    const balancesJson = stableJson(snap.balances)
    if (balancesJson !== this.lastBalancesJson) {
      this.lastBalancesJson = balancesJson
      onBalanceChanged({
        ...snap.balances,
        availableZatoshi: add(
          add(
            add(
              snap.balances.transparentAvailableZatoshi,
              snap.balances.saplingAvailableZatoshi
            ),
            snap.balances.orchardAvailableZatoshi
          ),
          snap.balances.ironwoodAvailableZatoshi
        ),
        totalZatoshi: add(
          add(
            add(
              snap.balances.transparentTotalZatoshi,
              snap.balances.saplingTotalZatoshi
            ),
            snap.balances.orchardTotalZatoshi
          ),
          snap.balances.ironwoodTotalZatoshi
        )
      })
    }

    if (snap.status !== this.lastStatus) {
      this.lastStatus = snap.status
      onStatusChanged({
        alias: this.alias,
        name: snap.status as 'STOPPED' | 'DISCONNECTED' | 'SYNCING' | 'SYNCED'
      })
    }

    const transactionsJson = stableJson(snap.transactions)
    if (transactionsJson !== this.lastTransactionsJson) {
      this.lastTransactionsJson = transactionsJson
      onTransactionsChanged({ transactions: snap.transactions })
    }

    onUpdate({
      alias: this.alias,
      scanProgress: snap.scanProgress,
      networkBlockHeight: snap.networkBlockHeight
    })
    return snap.status
  }
}

export const makeSynchronizer = async (
  initializerConfig: InitializerConfig
): Promise<Synchronizer> => {
  const synchronizer = new Synchronizer(
    initializerConfig.alias,
    initializerConfig.networkName
  )
  await synchronizer.initialize(initializerConfig)
  return synchronizer
}
