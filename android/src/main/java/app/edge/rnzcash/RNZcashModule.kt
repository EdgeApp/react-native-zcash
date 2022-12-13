package app.edge.rnzcash;

import cash.z.ecc.android.sdk.Initializer
import cash.z.ecc.android.sdk.SdkSynchronizer
import cash.z.ecc.android.sdk.Synchronizer
import cash.z.ecc.android.sdk.db.entity.*
import cash.z.ecc.android.sdk.ext.*
import cash.z.ecc.android.sdk.internal.transaction.PagedTransactionRepository
import cash.z.ecc.android.sdk.internal.*
import cash.z.ecc.android.sdk.type.*
import cash.z.ecc.android.sdk.tool.DerivationTool
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.nio.charset.StandardCharsets
import kotlin.coroutines.EmptyCoroutineContext

class WalletSynchronizer constructor(val initializer: Initializer)  {

    val synchronizer: SdkSynchronizer = Synchronizer.newBlocking(
        initializer
    ) as SdkSynchronizer
    val repository = runBlocking { PagedTransactionRepository.new(initializer.context, 10, initializer.rustBackend, initializer.birthday, initializer.viewingKeys) }
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
            runBlocking {
              Initializer.new(reactApplicationContext) {
                it.importedWalletBirthday(birthdayHeight)
                it.setViewingKeys(vk)
                it.setNetwork(networks[networkName]
                  ?: ZcashNetwork.Mainnet, defaultHost, defaultPort)
                it.alias = alias
              }
            }.let { initializer ->
              synchronizerMap[alias] = WalletSynchronizer(initializer)
            }
          }
          val wallet = getWallet(alias)
          wallet.synchronizer.hashCode().toString()
        }

    @ReactMethod
    fun start(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        if (!wallet.isStarted) {
            runBlocking {
              wallet.synchronizer.prepare()
            }
            wallet.synchronizer.start(moduleScope)
            val scope = wallet.synchronizer.coroutineScope
            wallet.synchronizer.processorInfo.collectWith(scope, { update ->
                sendEvent("UpdateEvent") { args ->
                    args.putString("alias", alias)
                    args.putInt("lastDownloadedHeight", update.lastDownloadedHeight)
                    args.putInt("lastScannedHeight", update.lastScannedHeight)
                    args.putInt("scanProgress", update.scanProgress)
                    args.putInt("networkBlockHeight", update.networkBlockHeight)
                }
            })
            wallet.synchronizer.status.collectWith(scope, { status ->
                sendEvent("StatusEvent") { args ->
                    args.putString("alias", alias)
                    args.putString("name", status.toString())
                }
            })
            wallet.synchronizer.saplingBalances.collectWith(scope, { walletBalance ->
                sendEvent("BalanceEvent") { args ->
                    args.putString("alias", alias)
                    args.putString("availableZatoshi", walletBalance.availableZatoshi.toString())
                    args.putString("totalZatoshi", walletBalance.totalZatoshi.toString())
                }
            })
            // add 'distinctUntilChanged' to filter by events that represent changes in txs, rather than each poll
            wallet.synchronizer.clearedTransactions.distinctUntilChanged().collectWith(scope, { txList ->
                sendEvent("TransactionEvent") { args ->
                    args.putString("alias", alias)
                    args.putBoolean("hasChanged", true)
                    args.putInt("transactionCount", txList.count())
                }
            })
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
            promise.wrap {
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

                nativeArray
            }
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
    fun deriveViewingKey(seedBytesHex: String, network: String = "mainnet", promise: Promise) {
        var keys = runBlocking { DerivationTool.deriveUnifiedViewingKeys(seedBytesHex.fromHex(), networks.getOrDefault(network, ZcashNetwork.Mainnet))[0] }
        val map = Arguments.createMap()
        map.putString("extfvk", keys.extfvk)
        map.putString("extpub", keys.extpub)
        promise.resolve(map)
    }

    @ReactMethod
    fun deriveSpendingKey(seedBytesHex: String, network: String = "mainnet", promise: Promise) = promise.wrap {
        runBlocking { DerivationTool.deriveSpendingKeys(seedBytesHex.fromHex(), networks.getOrDefault(network, ZcashNetwork.Mainnet))[0] }
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
    fun getShieldedBalance(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        val map = Arguments.createMap()
        map.putString("totalZatoshi", wallet.synchronizer.saplingBalances.value.totalZatoshi.toString(10))
        map.putString("availableZatoshi", wallet.synchronizer.saplingBalances.value.availableZatoshi.toString(10))
        map
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
        wallet.synchronizer.coroutineScope.launch {
            try {
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
                        if (tx.errorMessage != null) map.putString("errorMessage", tx.errorMessage)
                        if (tx.errorCode != null) map.putString("errorCode", tx.errorCode.toString())
                        promise.resolve(map)
                    }
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
    fun deriveShieldedAddress(viewingKey: String, network: String = "mainnet", promise: Promise) = promise.wrap {
        runBlocking { DerivationTool.deriveShieldedAddress(viewingKey, networks.getOrDefault(network, ZcashNetwork.Mainnet)) }
    }

    @ReactMethod
    fun isValidShieldedAddress(address: String, network: String, promise: Promise) {
        moduleScope.launch {
            promise.wrap {
                var isValid = false
                val wallets = synchronizerMap.asIterable()
            for (wallet in wallets) {
                if (wallet.value.synchronizer.network.networkName == network) {
                  isValid = wallet.value.synchronizer.isValidShieldedAddr(address)
                  break
                }
              }
              isValid
            }
        }
    }

    @ReactMethod
    fun isValidTransparentAddress(address: String, network: String, promise: Promise) {
        moduleScope.launch {
            promise.wrap {
              var isValid = false
              val wallets = synchronizerMap.asIterable()
              for (wallet in wallets) {
                if (wallet.value.synchronizer.network.networkName == network) {
                  isValid = wallet.value.synchronizer.isValidTransparentAddr(address)
                  break
                }
              }
              isValid
            }
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
        val args = Arguments.createMap()
        putArgs(args)
        reactApplicationContext
            .getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(eventName, args)
    }

    inline fun ByteArray.toHexReversed(): String {
      val sb = StringBuilder(size * 2)
      var i = size - 1
      while (i >= 0)
        sb.append(String.format("%02x", this[i--]))
      return sb.toString()
    }
}
