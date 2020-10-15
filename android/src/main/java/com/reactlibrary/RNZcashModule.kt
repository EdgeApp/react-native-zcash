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
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import kotlinx.coroutines.flow.distinctUntilChanged

class RNZcashModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    lateinit var synchronizer: SdkSynchronizer
    var isInitialized = false
    var isStarted = false

    override fun getName() = "RNZcash"

    @ReactMethod
    fun initialize(vk: String, birthdayHeight: Int, alias: String, promise: Promise) {
        Twig.plant(TroubleshootingTwig())
        if (!isInitialized) {
            synchronizer = Synchronizer(Initializer(reactApplicationContext) { config ->
                config.import(vk, birthdayHeight)
                config.server("lightwalletd.electriccoin.co", 9067)
                config.alias = alias
            }) as SdkSynchronizer
            isInitialized = true
        }
        promise.resolve(synchronizer.hashCode().toString())
    }

    @ReactMethod
    fun start() {
        if (isInitialized && !isStarted) {
            synchronizer.start()
            synchronizer.coroutineScope.let { scope ->
                synchronizer.processorInfo.collectWith(scope, ::onUpdate)
                synchronizer.status.collectWith(scope, ::onStatus)
                synchronizer.balances.collectWith(scope, ::onBalance)
                // add 'distinctUntilChanged' to filter by events that represent changes in txs, rather than each poll
                synchronizer.clearedTransactions.distinctUntilChanged().collectWith(scope, ::onTransactionsChange)
            }
            isStarted = true
        }
    }

    @ReactMethod
    fun stop() {
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
    fun deriveViewingKey(
        seedBytesHex: String,
        promise: Promise
    ) {
        try {
            promise.resolve(DerivationTool.deriveViewingKeys(seedBytesHex.fromHex())[0])
        } catch (e: Exception) {
            promise.reject("Err", e)
        }
    }

    @ReactMethod
    fun deriveSpendingKey(
        seedBytesHex: String,
        promise: Promise
    ) {
        try {
            promise.resolve(DerivationTool.deriveSpendingKeys(seedBytesHex.fromHex())[0])
        } catch (e: Exception) {
            promise.reject("Err", e)
        }
    }

    @ReactMethod
    fun getShieldedBalance(
        promise: Promise
    ) {
        try {
            val params = Arguments.createMap()
            params.putString("availableBalance", "1.1234")
            params.putString("totalBalance", "2.1234")
            promise.resolve(params)
        } catch (e: Exception) {
            promise.reject("Err", e)
        }
    }


    //
    // Event handlers
    //

    private fun onBalance(walletBalance: CompactBlockProcessor.WalletBalance) {
        sendEvent("BalanceEvent") { args ->
            args.putString("available", walletBalance.availableZatoshi.convertZatoshiToZecString())
            args.putString("total", walletBalance.totalZatoshi.convertZatoshiToZecString())
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

    private fun sendEvent(eventName: String, putArgs: (WritableMap) -> Unit) {
        Arguments.createMap().let { args ->
            putArgs(args)
            reactApplicationContext
                .getJSModule(RCTDeviceEventEmitter::class.java)
                .emit(eventName, args)
        }
    }

}
