package app.edge.rnzcash

import cash.z.ecc.android.sdk.SdkSynchronizer
import cash.z.ecc.android.sdk.Synchronizer
import cash.z.ecc.android.sdk.WalletInitMode
import cash.z.ecc.android.sdk.exception.LightWalletException
import cash.z.ecc.android.sdk.ext.*
import cash.z.ecc.android.sdk.internal.*
import cash.z.ecc.android.sdk.model.*
import cash.z.ecc.android.sdk.tool.DerivationTool
import cash.z.ecc.android.sdk.type.*
import co.electriccoin.lightwallet.client.LightWalletClient
import co.electriccoin.lightwallet.client.model.LightWalletEndpoint
import co.electriccoin.lightwallet.client.model.Response
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.Base64

class RNZcashModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    /**
     * Scope for anything that out-lives the synchronizer, meaning anything that can be used before
     * the synchronizer starts or after it stops. Everything else falls within the scope of the
     * synchronizer and should use `synchronizer.coroutineScope` whenever a scope is needed.
     */
    private var moduleScope: CoroutineScope = CoroutineScope(Dispatchers.IO)
    private var synchronizerMap = mutableMapOf<String, SdkSynchronizer>()

    // Track emitted transactions per alias to only emit new or updated transactions
    private val emittedTransactions = mutableMapOf<String, MutableMap<String, EmittedTxState>>()

    // Data class to track what we've emitted for each transaction
    private data class EmittedTxState(
        val minedHeight: BlockHeight?,
        val transactionState: TransactionState,
        val isExpired: Boolean,
    )

    private val networks = mapOf("mainnet" to ZcashNetwork.Mainnet, "testnet" to ZcashNetwork.Testnet)

    override fun getName() = "RNZcash"

    @ReactMethod
    fun initialize(
        seed: String,
        birthdayHeight: Int,
        alias: String,
        networkName: String = "mainnet",
        defaultHost: String = "mainnet.lightwalletd.com",
        defaultPort: Int = 9067,
        newWallet: Boolean,
        promise: Promise,
    ) {
        moduleScope.launch {
            promise.wrap {
                val network = networks.getOrDefault(networkName, ZcashNetwork.Mainnet)
                val endpoint = LightWalletEndpoint(defaultHost, defaultPort, true)
                val seedPhrase = SeedPhrase.new(seed)
                val initMode = if (newWallet) WalletInitMode.NewWallet else WalletInitMode.ExistingWallet
                if (!synchronizerMap.containsKey(alias)) {
                    synchronizerMap[alias] =
                        Synchronizer.new(
                            alias,
                            BlockHeight.new(birthdayHeight.toLong()),
                            reactApplicationContext,
                            endpoint,
                            AccountCreateSetup(
                                accountName = alias,
                                keySource = null,
                                seed = FirstClassByteArray(seedPhrase.toByteArray()),
                            ),
                            initMode,
                            network,
                            false, // isTorEnabled
                            false, // isExchangeRateEnabled
                        ) as SdkSynchronizer
                }
                val wallet = getWallet(alias)
                val scope = wallet.coroutineScope
                // Synchronizer.progress now blends scan + recovery and never hits 100%, so
                // read the un-blended per-wallet scan progress off the processor instead.
                combine(wallet.processor.scanProgress, wallet.networkHeight, wallet.status) { scanProgress, networkHeight, status ->
                    return@combine mapOf("scanProgress" to scanProgress, "networkHeight" to networkHeight, "status" to status)
                }.collectWith(scope) { map ->
                    val scanProgressDecimal = map["scanProgress"] as PercentDecimal
                    val status = map["status"] as Synchronizer.Status
                    var networkBlockHeight = map["networkHeight"] as BlockHeight?
                    if (networkBlockHeight == null) networkBlockHeight = BlockHeight.new(birthdayHeight.toLong())

                    // Report scan progress as a 0-100 percentage but keep the decimal places
                    // (no truncation) so consumers get granular, more frequent updates. Force
                    // 100.0 when SYNCED, and 0.0 when not actively syncing (stopped /
                    // disconnected / initializing) instead of reusing a stale percentage, to
                    // match the iOS module.
                    val scanProgress =
                        when (status) {
                            Synchronizer.Status.SYNCED -> 100.0
                            Synchronizer.Status.SYNCING -> scanProgressDecimal.decimal.toDouble() * 100
                            else -> 0.0
                        }

                    sendEvent("UpdateEvent") { args ->
                        args.putString("alias", alias)
                        args.putDouble("scanProgress", scanProgress)
                        args.putInt("networkBlockHeight", networkBlockHeight.value.toInt())
                    }
                }
                wallet.status.collectWith(scope) { status ->
                    sendEvent("StatusEvent") { args ->
                        args.putString("alias", alias)
                        args.putString("name", status.toString())
                    }
                }
                wallet.allTransactions.collectWith(scope) { txList ->
                    scope.launch {
                        // Get or create the tracking map for this alias
                        val emittedForAlias = emittedTransactions.getOrPut(alias) { mutableMapOf() }

                        val transactionsToEmit = mutableListOf<TransactionOverview>()

                        txList.forEach { tx ->
                            val txId = tx.txId.txIdString()
                            val previousState = emittedForAlias[txId]
                            val isExpired = isTxExpired(wallet, tx)

                            // Check if this is a new transaction or if minedHeight,
                            // transactionState, or the expired verdict changed. The
                            // expired verdict has its own trigger because it can flip
                            // on its own: the scan floor reaches a stuck transaction's
                            // expiry window without any tracked SDK field changing.
                            val isNew = previousState == null
                            val minedHeightChanged = previousState?.minedHeight != tx.minedHeight
                            val stateChanged = previousState?.transactionState != tx.transactionState
                            val expiredChanged = previousState?.isExpired != isExpired

                            // A transaction losing its mined height is the rewind undoing
                            // our own scan, not news about the transaction: it is still
                            // settled on chain, and the scan will find it again. Reporting
                            // it would refill the list the app empties for a resync, and
                            // would describe settled history as pending until the rescan
                            // caught up. Tracking still moves to the unmined state, so
                            // re-mining reads as a change and emits normally.
                            val unminedByRewind =
                                previousState?.minedHeight != null && tx.minedHeight == null

                            if (isNew || minedHeightChanged || stateChanged || expiredChanged) {
                                if (!unminedByRewind) transactionsToEmit.add(tx)
                                // Update our tracking
                                emittedForAlias[txId] =
                                    EmittedTxState(
                                        minedHeight = tx.minedHeight,
                                        transactionState = tx.transactionState,
                                        isExpired = isExpired,
                                    )
                            }
                        }

                        if (transactionsToEmit.isEmpty()) {
                            return@launch
                        }

                        // Parse in parallel, but fill the array on one thread:
                        // WritableArray is not safe for concurrent mutation, and
                        // these coroutines run on a multi-threaded dispatcher.
                        // Pushing in order also keeps the emitted order stable.
                        val parsedTxs =
                            transactionsToEmit
                                .map { tx -> async { parseTx(wallet, tx) } }
                                .map { it.await() }
                        val nativeArray = Arguments.createArray()
                        parsedTxs.forEach { nativeArray.pushMap(it) }

                        sendEvent("TransactionEvent") { args ->
                            args.putString("alias", alias)
                            args.putArray("transactions", nativeArray)
                        }
                    }
                }
                wallet.walletBalances.collectWith(scope) { balancesMap ->
                    val accountBalance = balancesMap?.values?.firstOrNull()
                    val transparentBalance = accountBalance?.unshielded
                    val saplingBalances = accountBalance?.sapling
                    val orchardBalances = accountBalance?.orchard

                    val transparentAvailableZatoshi = transparentBalance ?: Zatoshi(0L)
                    val transparentTotalZatoshi = transparentBalance ?: Zatoshi(0L)

                    val saplingAvailableZatoshi = saplingBalances?.available ?: Zatoshi(0L)
                    val saplingTotalZatoshi = saplingBalances?.total ?: Zatoshi(0L)

                    val orchardAvailableZatoshi = orchardBalances?.available ?: Zatoshi(0L)
                    val orchardTotalZatoshi = orchardBalances?.total ?: Zatoshi(0L)

                    val ironwoodBalances = accountBalance?.ironwood
                    val ironwoodAvailableZatoshi = ironwoodBalances?.available ?: Zatoshi(0L)
                    val ironwoodTotalZatoshi = ironwoodBalances?.total ?: Zatoshi(0L)

                    sendEvent("BalanceEvent") { args ->
                        args.putString("alias", alias)
                        args.putString("transparentAvailableZatoshi", transparentAvailableZatoshi.value.toString())
                        args.putString("transparentTotalZatoshi", transparentTotalZatoshi.value.toString())
                        args.putString("saplingAvailableZatoshi", saplingAvailableZatoshi.value.toString())
                        args.putString("saplingTotalZatoshi", saplingTotalZatoshi.value.toString())
                        args.putString("orchardAvailableZatoshi", orchardAvailableZatoshi.value.toString())
                        args.putString("orchardTotalZatoshi", orchardTotalZatoshi.value.toString())
                        args.putString("ironwoodAvailableZatoshi", ironwoodAvailableZatoshi.value.toString())
                        args.putString("ironwoodTotalZatoshi", ironwoodTotalZatoshi.value.toString())
                    }
                }

                fun handleError(
                    level: String,
                    error: Throwable?,
                ) {
                    sendEvent("ErrorEvent") { args ->
                        args.putString("alias", alias)
                        args.putString("level", level)
                        args.putString("message", error?.message ?: "Unknown error")
                    }
                }

                // Error listeners
                wallet.onCriticalErrorHandler = { error ->
                    handleError("critical", error)
                    false
                }
                wallet.onProcessorErrorHandler = { error ->
                    handleError("error", error)
                    true
                }
                wallet.onSetupErrorHandler = { error ->
                    handleError("error", error)
                    false
                }
                wallet.onChainErrorHandler = { errorHeight, rewindHeight ->
                    val message = "Chain error detected at height: $errorHeight. Rewinding to: $rewindHeight"
                    handleError("error", Throwable(message))
                }
                return@wrap null
            }
        }
    }

    @ReactMethod
    fun stop(
        alias: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        moduleScope.launch {
            try {
                wallet.closeFlow().first()
                synchronizerMap.remove(alias)
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    /**
     * Whether a transaction has expired without ever being mined - the same
     * verdict the wallet database's `v_transactions.expired_unmined` column
     * reaches, and the signal iOS reports as `isExpiredUmined`.
     *
     * This deliberately does NOT use `TransactionState.Expired`. That state
     * compares an unmined transaction's expiry height against the live network
     * tip, so while a rewound wallet rescans - a resync un-mines the entire
     * history until the scan re-reaches each block - every historical
     * transaction sits below the tip's expiry cutoff and gets branded expired,
     * and the app flashes the whole wallet as failed.
     *
     * Comparing against [CompactBlockProcessor.fullyScannedHeight] instead
     * mirrors the database's own rule: a transaction is expired only once the
     * wallet's contiguous scan has passed its expiry window without finding it
     * mined. The floor trails the database's `MAX(blocks.height)` while ranges
     * scan out of order, so this is equal-or-more conservative than the DB
     * flag and converges with it (and with iOS) once the wallet is synced.
     */
    private fun isTxExpired(
        wallet: SdkSynchronizer,
        tx: TransactionOverview,
    ): Boolean {
        if (tx.minedHeight != null) return false
        val expiryHeight = tx.expiryHeight ?: return false
        // An expiry height of 0 disables expiry:
        if (expiryHeight.value == 0L) return false
        val scanFloor: BlockHeight? = wallet.processor.fullyScannedHeight.value
        if (scanFloor == null) return false
        return expiryHeight.value <= scanFloor.value
    }

    private suspend fun parseTx(
        wallet: SdkSynchronizer,
        tx: TransactionOverview,
    ): WritableMap {
        val map = Arguments.createMap()
        val job =
            wallet.coroutineScope.launch {
                map.putString("value", tx.netValue.value.toString())
                tx.feePaid?.let { fee -> map.putString("fee", fee.value.toString()) }
                map.putInt("minedHeight", tx.minedHeight?.value?.toInt() ?: 0)
                map.putInt("blockTimeInSeconds", tx.blockTimeEpochSeconds?.toInt() ?: 0)
                map.putString("rawTransactionId", tx.txId.txIdString())
                map.putBoolean("isShielding", tx.isShielding)
                map.putBoolean("isExpired", isTxExpired(wallet, tx))
                tx.raw
                    ?.byteArray
                    ?.toHex()
                    ?.let { hex -> map.putString("raw", hex) }
                if (tx.isSentTransaction) {
                    try {
                        val recipient = wallet.getRecipients(tx).first()
                        if (recipient.addressValue != null) {
                            map.putString("toAddress", recipient.addressValue)
                        }
                    } catch (t: Throwable) {
                        // Error is OK. SDK limitation means we cannot find recipient for shielding transactions
                    }
                }
                if (tx.memoCount > 0) {
                    val memos = wallet.getMemos(tx).take(tx.memoCount).toList()
                    map.putArray("memos", Arguments.fromList(memos))
                } else {
                    map.putArray("memos", Arguments.createArray())
                }
            }
        job.join()
        return map
    }

    @ReactMethod
    fun rescan(
        alias: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        moduleScope.launch {
            // Forget only the transactions that are not mined. The app clears its
            // own transaction list for a resync and rebuilds it from what we emit,
            // so anything we still consider emitted will stay absent until the
            // rescan re-finds it - which is the point.
            //
            // Unmined transactions are the exception: the app just dropped them
            // too, and a rescan will never "find" one, because scanning only
            // discovers transactions in mined blocks. Forgetting them here means
            // the collector re-emits them once and they survive the resync.
            //
            // Clearing the whole map instead would re-emit every transaction at
            // its pre-rewind height, refilling the list the app had just emptied.
            emittedTransactions[alias]?.values?.removeAll { it.minedHeight == null }

            wallet.coroutineScope
                .async {
                    wallet.rewindToNearestHeight(wallet.latestBirthdayHeight)
                }.await()
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun deriveViewingKey(
        seed: String,
        network: String = "mainnet",
        promise: Promise,
    ) {
        moduleScope.launch {
            promise.wrap {
                val seedPhrase = SeedPhrase.new(seed)
                val keys =
                    DerivationTool.getInstance().deriveUnifiedFullViewingKeys(
                        seedPhrase.toByteArray(),
                        networks.getOrDefault(network, ZcashNetwork.Mainnet),
                        DerivationTool.DEFAULT_NUMBER_OF_ACCOUNTS,
                    )[0]
                return@wrap keys.encoding
            }
        }
    }

    //
    // Properties
    //

    @ReactMethod
    fun getLatestNetworkHeight(
        alias: String,
        promise: Promise,
    ) = promise.wrap {
        val wallet = getWallet(alias)
        return@wrap wallet.latestHeight
    }

    @ReactMethod
    fun getBirthdayHeight(
        host: String,
        port: Int,
        promise: Promise,
    ) {
        moduleScope.launch {
            promise.wrap {
                val endpoint = LightWalletEndpoint(host, port, true)
                val lightwalletService = LightWalletClient.new(reactApplicationContext, endpoint)
                return@wrap when (val response = lightwalletService.getLatestBlockHeight()) {
                    is Response.Success -> {
                        response.result.value.toInt()
                    }

                    is Response.Failure -> {
                        throw LightWalletException.DownloadBlockException(
                            response.code,
                            response.description,
                            response.toThrowable(),
                        )
                    }

                    else -> {
                        throw Exception("Unknown response type")
                    }
                }
            }
        }
    }

    @ReactMethod
    fun proposeTransfer(
        alias: String,
        zatoshi: String,
        toAddress: String,
        memo: String = "",
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                val account = wallet.getAccounts().first()
                val proposal =
                    wallet.proposeTransfer(
                        account,
                        toAddress,
                        Zatoshi(zatoshi.toLong()),
                        memo,
                    )
                val map = Arguments.createMap()
                map.putInt("transactionCount", proposal.transactionCount())
                map.putString("totalFee", proposal.totalFeeRequired().value.toString())
                map.putString("proposalBase64", Base64.getEncoder().encodeToString(proposal.toByteArray()))
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    @ReactMethod
    fun proposeFulfillingPaymentURI(
        alias: String,
        paymentUri: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                val account = wallet.getAccounts().first()
                val proposal =
                    wallet.proposeFulfillingPaymentUri(
                        account,
                        paymentUri,
                    )
                val map = Arguments.createMap()
                map.putInt("transactionCount", proposal.transactionCount())
                map.putString("totalFee", proposal.totalFeeRequired().value.toString())
                map.putString("proposalBase64", Base64.getEncoder().encodeToString(proposal.toByteArray()))
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    @kotlin.ExperimentalStdlibApi
    @ReactMethod
    fun createTransfer(
        alias: String,
        proposalBase64: String,
        seed: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                val seedPhrase = SeedPhrase.new(seed)
                val usk =
                    DerivationTool.getInstance().deriveUnifiedSpendingKey(
                        seedPhrase.toByteArray(),
                        wallet.network,
                        Zip32AccountIndex.new(0),
                    )
                val proposalByteArray = Base64.getDecoder().decode(proposalBase64)
                val proposal = Proposal.fromByteArray(proposalByteArray)

                val txs =
                    wallet.coroutineScope
                        .async {
                            wallet.createProposedTransactions(proposal, usk).take(proposal.transactionCount()).toList()
                        }.await()
                val txid = txs[txs.lastIndex].txIdString() // The last transfer is the most relevant to the user
                promise.resolve(txid)
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    @ReactMethod
    fun shieldFunds(
        alias: String,
        seed: String,
        memo: String,
        threshold: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                val account = wallet.getAccounts().first()
                val proposal = wallet.proposeShielding(account, Zatoshi(threshold.toLong()), memo, null)
                if (proposal == null) {
                    promise.reject("Err", Exception("Failed to propose shielding transaction"))
                    return@launch
                }
                val seedPhrase = SeedPhrase.new(seed)
                val usk =
                    DerivationTool.getInstance().deriveUnifiedSpendingKey(
                        seedPhrase.toByteArray(),
                        wallet.network,
                        Zip32AccountIndex.new(0),
                    )
                val result =
                    wallet.createProposedTransactions(
                        proposal,
                        usk,
                    )
                val shieldingTx = result.first()

                if (shieldingTx is TransactionSubmitResult.Success) {
                    val shieldingTxid = shieldingTx.txIdString()
                    promise.resolve(shieldingTxid)
                } else {
                    promise.reject("Err", Exception("Failed to create shielding transaction"))
                }
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    //
    // AddressTool
    //

    @ReactMethod
    fun deriveUnifiedAddress(
        alias: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                val account = wallet.getAccounts().first()
                val unifiedAddress = wallet.getUnifiedAddress(account)
                val saplingAddress = wallet.getSaplingAddress(account)
                val transparentAddress = wallet.getTransparentAddress(account)

                val map = Arguments.createMap()
                map.putString("unifiedAddress", unifiedAddress)
                map.putString("saplingAddress", saplingAddress)
                map.putString("transparentAddress", transparentAddress)
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    @ReactMethod
    fun isValidAddress(
        address: String,
        network: String,
        promise: Promise,
    ) {
        moduleScope.launch {
            promise.wrap {
                var isValid = false
                val wallets = synchronizerMap.asIterable()
                for (wallet in wallets) {
                    if (wallet.value.network.networkName == network) {
                        isValid = wallet.value.isValidAddress(address)
                        break
                    }
                }
                return@wrap isValid
            }
        }
    }

    //
    // region Orchard -> Ironwood migration (NU6.3) — v1 surface
    //
    // Signatures mirror the iOS bridge exactly, because the JS API is the
    // cross-platform contract. The SDK-backed work lives in IronwoodMigration.kt
    // and src/ironwood — see those for why it is bound at runtime rather than
    // called directly, and for which parts the Android SDK cannot serve yet.

    /**
     * Emits the wallet's current transaction set as a `TransactionEvent`.
     *
     * The `allTransactions` collector above delivers the full list on its first
     * emission, but that fires while `initialize` is still settling — before
     * JavaScript has attached its listeners — so the delivery is a race the app
     * can lose. Afterwards the collector only re-emits transactions whose mined
     * height or state changed, so anything that settled while nothing was
     * listening would never reach the app again.
     *
     * JavaScript calls this from `subscribe()`, once its listeners are attached,
     * which is the only point at which delivery is guaranteed. Re-sending known
     * transactions is harmless: the app updates only the ones that changed.
     */
    @ReactMethod
    fun emitExistingTransactions(
        alias: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                val txList = wallet.allTransactions.first()
                // Parse in parallel, but fill the array on one thread: see the
                // collector above - WritableArray is not safe for concurrent
                // mutation and these run on a multi-threaded dispatcher.
                val parsedTxs =
                    txList
                        .map { tx -> async { parseTx(wallet, tx) } }
                        .map { it.await() }
                val nativeArray = Arguments.createArray()
                parsedTxs.forEach { nativeArray.pushMap(it) }

                sendEvent("TransactionEvent") { args ->
                    args.putString("alias", alias)
                    args.putArray("transactions", nativeArray)
                }

                // Record what we just sent, so the allTransactions collector does
                // not treat these as unseen and emit the identical set a second
                // time - which would parse every transaction twice on each login.
                val emittedForAlias = emittedTransactions.getOrPut(alias) { mutableMapOf() }
                txList.forEach { tx ->
                    emittedForAlias[tx.txId.txIdString()] =
                        EmittedTxState(
                            minedHeight = tx.minedHeight,
                            transactionState = tx.transactionState,
                            isExpired = isTxExpired(wallet, tx),
                        )
                }
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    @ReactMethod
    fun ironwoodActivationHeight(
        networkName: String,
        promise: Promise,
    ) {
        promise.wrap {
            // An unrecognized network answers null, matching iOS and the
            // `number | null` JS contract. Defaulting to mainnet (as the
            // derivation methods in this file do) would report a height that is
            // wrong for the caller's network rather than admitting it has none.
            networks[networkName]?.let {
                IronwoodMigration.ironwoodActivationHeight(it)?.toInt()
            }
        }
    }

    @ReactMethod
    fun proposeOrchardToIronwoodMigration(
        alias: String,
        promise: Promise,
    ) {
        // Synchronizer-bound work belongs on the wallet's own scope, like every
        // other wallet method here: moduleScope outlives the synchronizer, so a
        // proposal could still be running against one that `stop` has closed.
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                promise.resolve(
                    IronwoodMigration.proposeOrchardToIronwoodMigration(wallet),
                )
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }
    }

    // endregion

    // Utilities
    //

    /**
     * Retrieve wallet object from synchronizer map
     */
    private fun getWallet(alias: String): SdkSynchronizer = synchronizerMap[alias] ?: throw Exception("Wallet not found")

    /**
     * Wrap the given block of logic in a promise, rejecting for any error.
     */
    private inline fun <T> Promise.wrap(block: () -> T) {
        try {
            resolve(block())
        } catch (t: Throwable) {
            reject("Err", t)
        }
    }

    private fun sendEvent(
        eventName: String,
        putArgs: (WritableMap) -> Unit,
    ) {
        val args = Arguments.createMap()
        putArgs(args)
        reactApplicationContext
            .getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(eventName, args)
    }
}
