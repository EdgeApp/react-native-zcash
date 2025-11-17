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
                combine(wallet.progress, wallet.networkHeight) { progress, networkHeight ->
                    return@combine mapOf("progress" to progress, "networkHeight" to networkHeight)
                }.collectWith(scope) { map ->
                    val progress = map["progress"] as PercentDecimal
                    var networkBlockHeight = map["networkHeight"] as BlockHeight?
                    if (networkBlockHeight == null) networkBlockHeight = BlockHeight.new(birthdayHeight.toLong())

                    sendEvent("UpdateEvent") { args ->
                        args.putString("alias", alias)
                        args.putInt(
                            "scanProgress",
                            progress.toPercentage(),
                        )
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

                            // Check if this is a new transaction or if minedHeight/transactionState changed
                            val isNew = previousState == null
                            val minedHeightChanged = previousState?.minedHeight != tx.minedHeight
                            val stateChanged = previousState?.transactionState != tx.transactionState

                            if (isNew || minedHeightChanged || stateChanged) {
                                transactionsToEmit.add(tx)
                                // Update our tracking
                                emittedForAlias[txId] =
                                    EmittedTxState(
                                        minedHeight = tx.minedHeight,
                                        transactionState = tx.transactionState,
                                    )
                            }
                        }

                        if (transactionsToEmit.isEmpty()) {
                            return@launch
                        }

                        val nativeArray = Arguments.createArray()
                        transactionsToEmit
                            .map { tx ->
                                launch {
                                    val parsedTx = parseTx(wallet, tx)
                                    nativeArray.pushMap(parsedTx)
                                }
                            }.forEach { it.join() }

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

                    sendEvent("BalanceEvent") { args ->
                        args.putString("alias", alias)
                        args.putString("transparentAvailableZatoshi", transparentAvailableZatoshi.value.toString())
                        args.putString("transparentTotalZatoshi", transparentTotalZatoshi.value.toString())
                        args.putString("saplingAvailableZatoshi", saplingAvailableZatoshi.value.toString())
                        args.putString("saplingTotalZatoshi", saplingTotalZatoshi.value.toString())
                        args.putString("orchardAvailableZatoshi", orchardAvailableZatoshi.value.toString())
                        args.putString("orchardTotalZatoshi", orchardTotalZatoshi.value.toString())
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
                wallet.onSubmissionErrorHandler = { error ->
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
                map.putBoolean("isExpired", tx.transactionState == TransactionState.Expired)
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
            // Clear emitted transactions tracking and starting block height for this alias
            emittedTransactions[alias]?.clear()

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
