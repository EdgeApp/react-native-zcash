package app.edge.rnzcash;

import androidx.paging.PagedList
import cash.z.ecc.android.sdk.Initializer
import cash.z.ecc.android.sdk.SdkSynchronizer
import cash.z.ecc.android.sdk.Synchronizer
import cash.z.ecc.android.sdk.Synchronizer.Status.SYNCED
import cash.z.ecc.android.sdk.block.CompactBlockProcessor
import cash.z.ecc.android.sdk.db.entity.*
import cash.z.ecc.android.sdk.ext.*
import cash.z.ecc.android.sdk.type.*
import cash.z.ecc.android.sdk.tool.DerivationTool
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import java.nio.charset.StandardCharsets
import kotlin.coroutines.EmptyCoroutineContext

class RNZcashModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    /**
     * Scope for anything that out-lives the synchronizer, meaning anything that can be used before
     * the synchronizer starts or after it stops. Everything else falls within the scope of the
     * synchronizer and should use `synchronizer.coroutineScope` whenever a scope is needed.
     *
     * In a real production app, we'd use the scope of the parent activity
     */
    var moduleScope: CoroutineScope = CoroutineScope(EmptyCoroutineContext)

    lateinit var synchronizer: SdkSynchronizer
    var isInitialized = false
    var isStarted = false

    override fun getName() = "RNZcash"

    @ReactMethod
    fun initialize(extfvk: String, extpub: String, birthdayHeight: Int, alias: String, promise: Promise) =
        promise.wrap {
            Twig.plant(TroubleshootingTwig())
            var vk = UnifiedViewingKey(extfvk, extpub)
            if (!isInitialized) {
                val initializer = Initializer(reactApplicationContext) { config ->
                    config.importedWalletBirthday(birthdayHeight)
                    config.setViewingKeys(vk)
                    config.setNetwork(ZcashNetwork.Mainnet)
                    config.alias = alias
                }
                synchronizer = Synchronizer(
                    initializer
                ) as SdkSynchronizer
                isInitialized = true
            }
            synchronizer.hashCode().toString()
        }

    @ReactMethod
    fun start(promise: Promise) = promise.wrap {
        if (isInitialized && !isStarted) {
            synchronizer.prepare()
            synchronizer.start(moduleScope)
            synchronizer.coroutineScope.let { scope ->
                synchronizer.processorInfo.collectWith(scope, ::onUpdate)
                synchronizer.status.collectWith(scope, ::onStatus)
                synchronizer.saplingBalances.collectWith(scope, ::onBalance)
                // add 'distinctUntilChanged' to filter by events that represent changes in txs, rather than each poll
                synchronizer.clearedTransactions.distinctUntilChanged()
                    .collectWith(scope, ::onTransactionsChange)
            }
            isStarted = true
        }
        isStarted
    }

    @ReactMethod
    fun stop(promise: Promise) = promise.wrap {
        isStarted = false
        synchronizer.stop()
    }

    @ReactMethod
    fun getTransactions(
        offset: Int,
        limit: Int,
        startDate: Long,
        endDate: Long,
        promise: Promise
    ) {
        // TODO: wrap and return transactions
        //customRepository.fetchTransactions(offset, limit, startDate, endDate)
    }

    @ReactMethod
    fun getBlockCount(
        promise: Promise
    ) = promise.wrap {
    }

    @ReactMethod
    fun deriveViewingKey(seedBytesHex: String, promise: Promise) {
        var keys = DerivationTool.deriveUnifiedViewingKeys(seedBytesHex.fromHex(), ZcashNetwork.Mainnet)[0]
        val map = Arguments.createMap()
        map.putString("extfvk", keys.extfvk)
        map.putString("extpub", keys.extpub)
        promise.resolve(map)
    }

    @ReactMethod
    fun deriveSpendingKey(seedBytesHex: String, promise: Promise) = promise.wrap {
        DerivationTool.deriveSpendingKeys(seedBytesHex.fromHex(), ZcashNetwork.Mainnet)[0]
    }

    //
    // Properties
    //


    @ReactMethod
    fun getLatestNetworkHeight(promise: Promise) = promise.wrap {
        synchronizer.latestHeight
    }

    @ReactMethod
    fun getLatestScannedHeight(promise: Promise) = promise.wrap {
        // TODO: implement this after switching to StateFlow objects
        throw NotImplementedError()
    }

    @ReactMethod
    fun getProgress(promise: Promise) = promise.wrap {
        // TODO: implement this after switching to StateFlow objects
        throw NotImplementedError()
    }

    @ReactMethod
    fun getStatus(promise: Promise) = promise.wrap {
        // TODO: implement this after switching to StateFlow objects
        throw NotImplementedError()
    }

    @ReactMethod
    fun getShieldedBalance(promise: Promise) {
        val map = Arguments.createMap()
        map.putString("totalZatoshi", synchronizer.saplingBalances.value.totalZatoshi.toString(10))
        map.putString("availableZatoshi", synchronizer.saplingBalances.value.availableZatoshi.toString(10))
        promise.resolve(map)
    }

    @ReactMethod
    fun spendToAddress(
        zatoshi: String,
        toAddress: String,
        memo: String,
        fromAccountIndex: Int,
        spendingKey: String,
        promise: Promise
    ) {
        try {
            synchronizer.coroutineScope.launch {
                synchronizer.sendToAddress(
                    spendingKey,
                    zatoshi.toLong(),
                    toAddress,
                    memo,
                    fromAccountIndex
                ).collectWith(synchronizer.coroutineScope) {tx ->
                    // this block is called repeatedly for each update to the pending transaction, including all 10 confirmations
                    // the promise either shouldn't be used (and rely on events instead) or it can be resolved once the transaction is submitted to the network or mined
                    if (tx.isSubmitSuccess()) { // alternatively use it.isMined() but be careful about making a promise that never resolves!
                        promise.resolve(true)
                    } else if (tx.isFailure()) {
                        promise.resolve(false)
                    }
                    sendEvent("PendingTransactionUpdated") { args ->
                        args.putPendingTransaction(tx)
                    }
                }
            }
        } catch (t: Throwable) {
            promise.reject("Err", t)
        }
    }

    //
    // AddressTool
    //

    @ReactMethod
    fun deriveShieldedAddress(viewingKey: String, promise: Promise) = promise.wrap {
        DerivationTool.deriveShieldedAddress(viewingKey, ZcashNetwork.Mainnet)
    }

    @ReactMethod
    fun deriveTransparentAddress(seed: String, network: ZcashNetwork = ZcashNetwork.Mainnet, promise: Promise) = promise.wrap {
        DerivationTool.deriveTransparentAddress(seed.fromHex(), network)
    }

    @ReactMethod
    fun isValidShieldedAddress(address: String, promise: Promise) {
        try {
            moduleScope.launch {
                promise.resolve(synchronizer.isValidShieldedAddr(address))
            }
        } catch (t: Throwable) {
            promise.reject("Err", t)
        }
    }

    @ReactMethod
    fun isValidTransparentAddress(address: String, promise: Promise) {
        try {
            moduleScope.launch {
                promise.resolve(synchronizer.isValidTransparentAddr(address))
            }
        } catch (t: Throwable) {
            promise.reject("Err", t)
        }
    }


    //
    // Event handlers
    //

    private fun onBalance(walletBalance: WalletBalance) {
        sendEvent("BalanceEvent") { args ->
            args.putString("availableZatoshi", walletBalance.availableZatoshi.toString())
            args.putString("totalZatoshi", walletBalance.totalZatoshi.toString())
        }
    }

    private fun onStatus(status: Synchronizer.Status) {
        sendEvent("StatusEvent") { args ->
            args.putString("name", status.name)
        }
    }

    private fun onUpdate(processorInfo: CompactBlockProcessor.ProcessorInfo) {
        sendEvent("UpdateEvent") { args ->
            processorInfo.let { info ->
                args.putBoolean("isDownloading", info.isDownloading)
                args.putBoolean("isScanning", info.isScanning)
                args.putInt("lastDownloadedHeight", info.lastDownloadedHeight)
                args.putInt("lastScannedHeight", info.lastScannedHeight)
                args.putInt("scanProgress", info.scanProgress)
                args.putInt("networkBlockHeight", info.networkBlockHeight)
            }
        }
    }

    private fun onTransactionsChange(txList: List<ConfirmedTransaction>) {
        // send a tickle and allow the client to follow up with a poll
        // however, we could also just send the client exactly what it wants (like the last 10 txs)
        sendEvent("TransactionEvent") { args ->
            args.putBoolean("hasChanged", true)
            args.putInt("transactionCount", txList.count())
        }
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        try {
            // cancelling the parent scope will also stop the synchronizer, through structured concurrency
            // so calling synchronizer.stop() here is possible but redundant
            moduleScope.cancel()
        } catch (t: Throwable) {
            // ignore
        }
    }


    //
    // Test functions (remove these, later)
    //

    @ReactMethod
    fun readyToSend(promise: Promise) {
        try {
            // for testing purposes, one is enough--we just want to make sure we're not downloading
            synchronizer.status.filter { it == SYNCED }.onFirstWith(synchronizer.coroutineScope) {
                promise.resolve(true)
            }
        } catch (t: Throwable) {
            promise.reject("Err", t)
        }
    }


    //
    // Utilities
    //

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

    /**
     * Serialize a pending tranaction to a map as an event
     */
    private fun WritableMap.putPendingTransaction(tx: PendingTransaction) {
        // TODO: we need to be really clear on what a non-error value is. For now, just use a placeholder
        val noError = 0
        // interface PendingTransaction
        putInt("accountIndex", tx.accountIndex)
        putInt("accountIndex", tx.accountIndex)
        putInt("expiryHeight", tx.expiryHeight)
        putBoolean("cancelled", tx.isCancelled())
        putInt("submitAttempts", tx.submitAttempts)
        putString("errorMessage", tx.errorMessage)
        putInt("errorCode", tx.errorCode ?: noError)
        putString("createTime", tx.createTime.toString())

        // interface ZcashTransaction
        putString("txId", tx.rawTransactionId?.toHexReversed())
        putString("fee", ZcashSdk.MINERS_FEE_ZATOSHI.toString())
        putString("zatoshi", tx.value.toString())
        // TODO: use the extension properties for this once they exist
        putBoolean("isInbound", false)
        putBoolean("isOutbound", true) // pendingTransactions are, by definition, outbound
        putString("toAddress", tx.toAddress)
        putString("memo", tx.memo.toUtf8Memo())
        putInt("minedHeight", tx.minedHeight)

        // TODO: missing from API, like minedHeight, this could be set after it is mined and null otherwise
//        putInt("blockTime", tx.blockTime)
    }

    private fun sendEvent(eventName: String, putArgs: (WritableMap) -> Unit) {
        Arguments.createMap().let { args ->
            putArgs(args)
            reactApplicationContext
                .getJSModule(RCTDeviceEventEmitter::class.java)
                .emit(eventName, args)
        }
    }

    // TODO: move this to the SDK
    inline fun ByteArray?.toUtf8Memo(): String {
        return if (this == null || this[0] >= 0xF5) "" else try {
            // trim empty and "replacement characters" for codes that can't be represented in unicode
            String(this, StandardCharsets.UTF_8).trim('\u0000', '\uFFFD')
        } catch (t: Throwable) {
            "Unable to parse memo."
        }
    }
}
