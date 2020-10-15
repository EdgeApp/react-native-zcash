package com.reactlibrary;

import androidx.paging.PagedList
import cash.z.ecc.android.sdk.Initializer
import cash.z.ecc.android.sdk.SdkSynchronizer
import cash.z.ecc.android.sdk.Synchronizer
import cash.z.ecc.android.sdk.block.CompactBlockProcessor
import cash.z.ecc.android.sdk.db.entity.ConfirmedTransaction
import cash.z.ecc.android.sdk.ext.*
import cash.z.ecc.android.sdk.tool.DerivationTool
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
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
    fun initialize(vk: String, birthdayHeight: Int, alias: String, promise: Promise) = promise.wrap {
            Twig.plant(TroubleshootingTwig())
            if (!isInitialized) {
                synchronizer = Synchronizer(Initializer(reactApplicationContext) { config ->
                    config.import(vk, birthdayHeight)
                    config.server("lightwalletd.electriccoin.co", 9067)
                    config.alias = alias
                }) as SdkSynchronizer
                isInitialized = true
            }
            synchronizer.hashCode().toString()
        }

    @ReactMethod
    fun start(promise: Promise) = promise.wrap {
        if (isInitialized && !isStarted) {
            synchronizer.start(moduleScope)
            synchronizer.coroutineScope.let { scope ->
                synchronizer.processorInfo.collectWith(scope, ::onUpdate)
                synchronizer.status.collectWith(scope, ::onStatus)
                synchronizer.balances.collectWith(scope, ::onBalance)
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
    fun getNumTransactions(
        N: Float,
        promise: Promise
    ) {
//        try {
////      (new Runnable(){
////        @Override
////        public void run() {
////          WritableMap params = Arguments.createMap();
////          params.putString("foo", "bar");
////          try {
////            Thread.sleep(20000);
////          }catch(InterruptedException e) {
////            //do nothing
////          }
////          sendEvent(reactContext, "FooEvent", params);
////        }
////      }).run();
//            val params = Arguments.createMap()
//            params.putString("foo", "bar3")
//            sendEvent(reactContext, "FooEvent", params)
//            try {
//                Thread.sleep(20000)
//            } catch (e: InterruptedException) {
//                //do nothing
//            }
//            promise.resolve(N + 43)
//        } catch (e: Exception) {
//            promise.reject("Err", e)
//        }
    }

    @ReactMethod
    fun deriveViewingKey(seedBytesHex: String, promise: Promise) = promise.wrap {
        DerivationTool.deriveViewingKeys(seedBytesHex.fromHex())[0]
    }

    @ReactMethod
    fun deriveSpendingKey(seedBytesHex: String, promise: Promise) = promise.wrap {
        DerivationTool.deriveSpendingKeys(seedBytesHex.fromHex())[0]
    }

    @ReactMethod
    fun getShieldedBalance(promise: Promise) = promise.wrap {
        val params = Arguments.createMap()
        params.putString("availableBalance", "1.1234")
        params.putString("totalBalance", "2.1234")
        params
    }


    //
    // AddressTool
    //

    @ReactMethod
    fun deriveShieldedAddress(viewingKey: String, promise: Promise) = promise.wrap {
        DerivationTool.deriveShieldedAddress(viewingKey)
    }

    @ReactMethod
    fun deriveTransparentAddress(seed: String, promise: Promise) = promise.wrap {
        DerivationTool.deriveTransparentAddress(seed.fromHex())
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

    private fun onBalance(walletBalance: CompactBlockProcessor.WalletBalance) {
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

    private fun onTransactionsChange(txList: PagedList<ConfirmedTransaction>) {
        // send a tickle and allow the client to follow up with a poll
        // however, we could also just send the client exactly what it wants (like the last 10 txs)
        sendEvent("TransactionEvent") { args ->
            args.putBoolean("hasChanged", true)
            args.putInt("transactionCount", txList.count())
        }

        // sanity check
        txList.forEach {
            twig("Found tx at height: ${it.minedHeight} with value: ${it.value} and toAddr: ${it.toAddress}. Screw $it")
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

    private fun sendEvent(eventName: String, putArgs: (WritableMap) -> Unit) {
        Arguments.createMap().let { args ->
            putArgs(args)
            reactApplicationContext
                .getJSModule(RCTDeviceEventEmitter::class.java)
                .emit(eventName, args)
        }
    }
}