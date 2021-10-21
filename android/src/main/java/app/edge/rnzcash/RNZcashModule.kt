package app.edge.rnzcash;

import androidx.paging.PagedList
import cash.z.ecc.android.sdk.Initializer
import cash.z.ecc.android.sdk.SdkSynchronizer
import cash.z.ecc.android.sdk.Synchronizer
import cash.z.ecc.android.sdk.Synchronizer.Status.SYNCED
import cash.z.ecc.android.sdk.block.CompactBlockProcessor
import cash.z.ecc.android.sdk.db.entity.*
import cash.z.ecc.android.sdk.ext.*
import cash.z.ecc.android.sdk.transaction.*
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

class WalletSynchronizer constructor(val initializer: Initializer)  {
    
    val synchronizer: SdkSynchronizer = Synchronizer(
        initializer
    ) as SdkSynchronizer
    val repository = PagedTransactionRepository(initializer.context, 10, initializer.rustBackend, initializer.birthday, initializer.viewingKeys)
    var isInitialized = false
    var isStarted = false
}

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
    var synchronizerMap = mutableMapOf<String, WalletSynchronizer>()

    val networks = mapOf("mainnet" to ZcashNetwork.Mainnet, "testnet" to ZcashNetwork.Testnet)

    override fun getName() = "RNZcash"

    @ReactMethod
    fun initialize(extfvk: String, extpub: String, birthdayHeight: Int, alias: String, networkName: String = "mainnet", defaultHost: String = "mainnet.lightwalletd.com", defaultPort: Int = 9067, promise: Promise) =
        promise.wrap {
            Twig.plant(TroubleshootingTwig())
            var vk = UnifiedViewingKey(extfvk, extpub)
            if (synchronizerMap[alias] == null) {
                val initializer = Initializer(reactApplicationContext) { config ->
                    config.importedWalletBirthday(birthdayHeight)
                    config.setViewingKeys(vk)
                    config.setNetwork(networks[networkName] ?: ZcashNetwork.Mainnet, defaultHost, defaultPort)
                    config.alias = alias
                }
                synchronizerMap[alias] = WalletSynchronizer(initializer)
                val wallet = getWallet(alias)
                wallet.isInitialized = true
            }
            val wallet = getWallet(alias)
            wallet.synchronizer.hashCode().toString()
            
        }

    @ReactMethod
    fun start(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        if (wallet.isInitialized && !wallet.isStarted) {
            wallet.synchronizer.prepare()
            wallet.synchronizer.start(moduleScope)
            wallet.synchronizer.coroutineScope.let { scope ->
                wallet.synchronizer.processorInfo.collectWith(scope, { update ->
                    sendEvent("UpdateEvent") { args ->
                        update.let { info ->
                            args.putString("alias", alias)
                            args.putBoolean("isDownloading", info.isDownloading)
                            args.putBoolean("isScanning", info.isScanning)
                            args.putInt("lastDownloadedHeight", info.lastDownloadedHeight)
                            args.putInt("lastScannedHeight", info.lastScannedHeight)
                            args.putInt("scanProgress", info.scanProgress)
                            args.putInt("networkBlockHeight", info.networkBlockHeight)
                        }
                    }
                })
                wallet.synchronizer.status.collectWith(scope, { status -> 
                    sendEvent("StatusEvent") { args ->
                        args.putString("alias", alias)
                        args.putString("name", status.toString())
                    }
                }
                )
                wallet.synchronizer.saplingBalances.collectWith(scope, { walletBalance ->
                    sendEvent("BalanceEvent") { args ->
                        args.putString("alias", alias)
                        args.putString("availableZatoshi", walletBalance.availableZatoshi.toString())
                        args.putString("totalZatoshi", walletBalance.totalZatoshi.toString())
                    }
                })
                // add 'distinctUntilChanged' to filter by events that represent changes in txs, rather than each poll
                wallet.synchronizer.clearedTransactions.distinctUntilChanged()
                    .collectWith(scope, { txList ->
                        sendEvent("TransactionEvent") { args ->
                            args.putString("alias", alias)
                            args.putBoolean("hasChanged", true)
                            args.putInt("transactionCount", txList.count())
                        }
                    })
            }
            wallet.repository.prepare()
            wallet.isStarted = true
        }
        "success"
    }

    @ReactMethod
    fun stop(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        wallet.synchronizer.stop()
        synchronizerMap.remove(alias)
        "success"
    }

    @ReactMethod
    fun getTransactions(alias: String, first: Int, last: Int, promise: Promise) {
        val wallet = getWallet(alias)
        moduleScope.launch {
            val result = wallet.repository.findNewTransactions(first..last)
            val nativeArray = Arguments.createArray()

            for (i in 0..result.size - 1) {
                val map = Arguments.createMap()
                map.putString("value", result[i].value.toString())
                map.putInt("minedHeight", result[i].minedHeight)
                map.putInt("blockTimeInSeconds", result[i].blockTimeInSeconds.toInt())
                map.putString("rawTransactionId", result[i].rawTransactionId.toHexReversed())
                if (result[i].memo != null) map.putString("memo", result[i].memo?.decodeToString()?.trim('\u0000', '\uFFFD'))
                if (result[i].toAddress != null) map.putString("toAddress", result[i].toAddress)
                nativeArray.pushMap(map)
            }

            promise.resolve(nativeArray)
        }
    }

    @ReactMethod
    fun rescan(alias: String, height: Int, promise: Promise) {
        val wallet = getWallet(alias)
        moduleScope.launch {
            wallet.synchronizer.rewindToNearestHeight(height)
        }
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
    fun getLatestNetworkHeight(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        wallet.synchronizer.latestHeight
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
    fun getShieldedBalance(alias: String, promise: Promise) {
        val wallet = getWallet(alias)
        val map = Arguments.createMap()
        map.putString("totalZatoshi", wallet.synchronizer.saplingBalances.value.totalZatoshi.toString(10))
        map.putString("availableZatoshi", wallet.synchronizer.saplingBalances.value.availableZatoshi.toString(10))
        promise.resolve(map)
    }

    @ReactMethod
    fun spendToAddress(
        alias: String,
        zatoshi: String,
        toAddress: String,
        memo: String,
        fromAccountIndex: Int,
        spendingKey: String,
        promise: Promise
    ) {
        val wallet = getWallet(alias)
        try {
            wallet.synchronizer.coroutineScope.launch {
                wallet.synchronizer.sendToAddress(
                    spendingKey,
                    zatoshi.toLong(),
                    toAddress,
                    memo,
                    fromAccountIndex
                ).collectWith(wallet.synchronizer.coroutineScope) {tx ->
                    // this block is called repeatedly for each update to the pending transaction, including all 10 confirmations
                    // the promise either shouldn't be used (and rely on events instead) or it can be resolved once the transaction is submitted to the network or mined
                    if (tx.isSubmitSuccess()) { // alternatively use it.isMined() but be careful about making a promise that never resolves!
                        val map = Arguments.createMap()
                        map.putString("txId", tx.rawTransactionId?.toHexReversed())
                        map.putString("raw", tx.raw?.toHexReversed())
                        promise.resolve(map)
                    } else if (tx.isFailure()) {
                        val map = Arguments.createMap()
                        map.putInt("expiryHeight", tx.expiryHeight)
                        map.putString("cancelled", tx.cancelled.toString())
                        map.putString("encodeAttempts", tx.encodeAttempts.toString())
                        map.putString("submitAttempts", tx.submitAttempts.toString())
                        if (tx.errorMessage != null) map.putString("errorMessage", tx.errorMessage)
                        if (tx.errorCode != null) map.putString("errorCode", tx.errorCode.toString())
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
        val wallet = getAnyWallet()
        try {
            moduleScope.launch {
                promise.resolve(wallet.synchronizer.isValidShieldedAddr(address))
            }
        } catch (t: Throwable) {
            promise.reject("Err", t)
        }
    }

    @ReactMethod
    fun isValidTransparentAddress(alias: String, address: String, promise: Promise) {
        val wallet = getAnyWallet()
        try {
            moduleScope.launch {
                promise.resolve(wallet.synchronizer.isValidTransparentAddr(address))
            }
        } catch (t: Throwable) {
            promise.reject("Err", t)
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
    fun readyToSend(alias: String, promise: Promise) {
        val wallet = getWallet(alias)
        try {
            // for testing purposes, one is enough--we just want to make sure we're not downloading
            wallet.synchronizer.status.filter { it == SYNCED }.onFirstWith(wallet.synchronizer.coroutineScope) {
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
     * Retrieve wallet object from synchronizer map
     */    
    private fun getWallet(alias: String): WalletSynchronizer {
        val wallet = synchronizerMap.get(alias)
        if (wallet == null) throw Exception("Wallet not found")
        return wallet
    }
    
    
    /**
     * Retrieve any wallet object for tasks that need simple synchronizer 
     * functions like address validation
     */
    private fun getAnyWallet(): WalletSynchronizer {
        val wallet = synchronizerMap.firstNotNullOf { it.takeIf { it != null } }
        return wallet.value
    }

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
        sendEvent("PendingTransactionUpdated") { args ->
            tx.let { info ->
                if (tx.accountIndex != null ) putInt("accountIndex", tx.accountIndex)
                if (tx.expiryHeight != null ) putInt("expiryHeight", tx.expiryHeight)
                if (tx.submitAttempts != null ) putInt("submitAttempts", tx.submitAttempts)
                if (tx.errorMessage != null ) putString("errorMessage", tx.errorMessage)
                if (tx.createTime != null ) putString("PendingTransactionUpdated", tx.createTime.toString())
            }
        }
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
