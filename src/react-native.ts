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
  SynchronizerCallbacks
} from './types'
export * from './types'

const { RNZcash } = NativeModules

type Callback = (...args: any[]) => any

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
   * network has none. Stateless — safe to call before any synchronizer
   * exists; the app gates migration UI on the chain reaching this height.
   * Answers on both platforms: these are consensus constants (ZIP 258), which
   * neither SDK exposes.
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
    return result
  }

  async proposeTransfer(opts: ProposeTransferOpts): Promise<ProposalSuccess> {
    const result = await RNZcash.proposeTransfer(
      this.alias,
      opts.zatoshi,
      opts.toAddress,
      opts.memo
    )
    return result
  }

  async proposeFulfillingPaymentURI(
    paymentUri: string
  ): Promise<ProposalSuccess> {
    const result = await RNZcash.proposeFulfillingPaymentURI(
      this.alias,
      paymentUri
    )
    return result
  }

  async createTransfer(
    opts: CreateTransferOpts
  ): Promise<string | SpendFailure> {
    const result = await RNZcash.createTransfer(
      this.alias,
      opts.proposalBase64,
      opts.mnemonicSeed
    )
    return result
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

  // Events

  subscribe({
    onBalanceChanged,
    onStatusChanged,
    onTransactionsChanged,
    onUpdate,
    onError
  }: SynchronizerCallbacks): void {
    this.setListener('BalanceEvent', event => {
      // Both platforms emit these, but an older native build paired with a
      // newer JS bundle would not; default them so the shape is consistent:
      event.ironwoodAvailableZatoshi = event.ironwoodAvailableZatoshi ?? '0'
      event.ironwoodTotalZatoshi = event.ironwoodTotalZatoshi ?? '0'

      const {
        transparentAvailableZatoshi,
        transparentTotalZatoshi,
        saplingAvailableZatoshi,
        saplingTotalZatoshi,
        orchardAvailableZatoshi,
        orchardTotalZatoshi,
        ironwoodAvailableZatoshi,
        ironwoodTotalZatoshi
      } = event

      // The deprecated sums mean "the whole wallet": ironwood must be
      // included so funds don't vanish from them mid-migration.
      event.availableZatoshi = add(
        add(
          add(transparentAvailableZatoshi, saplingAvailableZatoshi),
          orchardAvailableZatoshi
        ),
        ironwoodAvailableZatoshi
      )
      event.totalZatoshi = add(
        add(
          add(transparentTotalZatoshi, saplingTotalZatoshi),
          orchardTotalZatoshi
        ),
        ironwoodTotalZatoshi
      )
      onBalanceChanged(event)
    })
    this.setListener('StatusEvent', onStatusChanged)
    this.setListener('TransactionEvent', onTransactionsChanged)
    this.setListener('UpdateEvent', onUpdate)
    this.setListener('ErrorEvent', onError)

    // Native drops events until a listener exists, and its transaction stream
    // only carries what is newly found or newly mined. A transaction that
    // settled while nothing was listening - mined while the app was closed, or
    // during a failed sync - would otherwise never be reported again and would
    // stay pending forever. Ask for the current set now that the listeners
    // above are attached; this ordering is what makes the delivery reliable.
    RNZcash.emitExistingTransactions(this.alias).catch((error: unknown) => {
      onError({
        alias: this.alias,
        level: 'error',
        message: `emitExistingTransactions failed: ${String(error)}`
      })
    })
  }

  private setListener<T>(
    eventName: string,
    callback: Callback = (t: any) => null
  ): void {
    this.subscriptions.push(
      this.eventEmitter.addListener(eventName, arg =>
        arg.alias === this.alias ? callback(arg) : null
      )
    )
  }

  unsubscribe(): void {
    this.subscriptions.forEach(subscription => {
      subscription.remove()
    })
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
