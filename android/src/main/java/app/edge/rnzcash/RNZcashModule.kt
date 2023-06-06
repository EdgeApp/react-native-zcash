package app.edge.rnzcash;

import cash.z.ecc.android.sdk.SdkSynchronizer
import cash.z.ecc.android.sdk.Synchronizer
import cash.z.ecc.android.sdk.exception.LightWalletException
import cash.z.ecc.android.sdk.ext.*
import cash.z.ecc.android.sdk.internal.*
import cash.z.ecc.android.sdk.model.*
import cash.z.ecc.android.sdk.type.*
import cash.z.ecc.android.sdk.tool.DerivationTool
import co.electriccoin.lightwallet.client.LightWalletClient
import co.electriccoin.lightwallet.client.model.LightWalletEndpoint
import co.electriccoin.lightwallet.client.model.Response
import co.electriccoin.lightwallet.client.new
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
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
    var synchronizerMap = mutableMapOf<String, SdkSynchronizer>()

    val networks = mapOf("mainnet" to ZcashNetwork.Mainnet, "testnet" to ZcashNetwork.Testnet)

    override fun getName() = "RNZcash"

    @ReactMethod
    fun initialize(seed: String, birthdayHeight: Int, alias: String, networkName: String = "mainnet", defaultHost: String = "mainnet.lightwalletd.com", defaultPort: Int = 9067, promise: Promise) =
        moduleScope.launch {
        promise.wrap {
          var network = networks.getOrDefault(networkName, ZcashNetwork.Mainnet)
          var endpoint = LightWalletEndpoint(defaultHost, defaultPort, true)
          if (!synchronizerMap.containsKey(alias)) {
            synchronizerMap.set(alias, Synchronizer.new(reactApplicationContext, network, alias, endpoint, seed.toByteArray(), BlockHeight.new(network, birthdayHeight.toLong())) as SdkSynchronizer)
          }
          val wallet = getWallet(alias)
          val scope = wallet.coroutineScope
            wallet.processorInfo.collectWith(scope, { update ->
            var lastDownloadedHeight = runBlocking { wallet.processor.downloader.getLastDownloadedHeight() }
            if (lastDownloadedHeight == null) lastDownloadedHeight = BlockHeight.new(wallet.network, birthdayHeight.toLong())

            var lastScannedHeight = update.lastSyncedHeight
            if (lastScannedHeight == null) lastScannedHeight = BlockHeight.new(wallet.network, birthdayHeight.toLong())

            var networkBlockHeight = update.networkBlockHeight
            if (networkBlockHeight == null) networkBlockHeight = BlockHeight.new(wallet.network, birthdayHeight.toLong())

            sendEvent("UpdateEvent") { args ->
                args.putString("alias", alias)
                args.putInt("lastDownloadedHeight", lastDownloadedHeight.value.toInt())
                args.putInt("lastScannedHeight", lastScannedHeight.value.toInt())
                args.putInt("scanProgress", wallet.processor.progress.value.toPercentage())
                args.putInt("networkBlockHeight", networkBlockHeight.value.toInt())
            }
            })
            wallet.status.collectWith(scope, { status ->
                sendEvent("StatusEvent") { args ->
                    args.putString("alias", alias)
                    args.putString("name", status.toString())
                }
            })
          return@wrap null
        }
    }

    @ReactMethod
    fun stop(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        wallet.close()
        synchronizerMap.remove(alias)
        return@wrap null
    }

    @ReactMethod
    fun getTransactions(alias: String, first: Int, last: Int, promise: Promise) {
        val wallet = getWallet(alias)
        moduleScope.launch {
            promise.wrap {
                val result = runBlocking { wallet.transactions.flatMapConcat { it.asFlow() }
                .takeWhile { it.minedHeight == null || it.minedHeight!! >= BlockHeight.new(wallet.network, first.toLong()) }
                .filter { it.minedHeight == null || it.minedHeight!! <= BlockHeight.new(wallet.network, last.toLong()) }
                .toList() }
                val nativeArray = Arguments.createArray()

                for (i in 0..result.size - 1) {
                    if (result[i].minedHeight == null) continue
                    val map = Arguments.createMap()
                    map.putString("value", result[i].netValue.toString())
                    map.putInt("minedHeight", result[i].minedHeight.toString().toInt())
                    map.putInt("blockTimeInSeconds", result[i].blockTimeEpochSeconds.toInt())
                    map.putString("rawTransactionId", result[i].rawId.toString())

                    val memos = runBlocking { wallet.getMemos(result[i]).takeWhile { it != null }.toList() }
                    map.putString("memo", memos.joinToString(" "))
                    val recipients = runBlocking { wallet.getRecipients(result[i]).takeWhile { it != null }.toList() }
                    map.putString("toAddress", recipients.joinToString(" "))
                    nativeArray.pushMap(map)
                }

                return@wrap nativeArray
            }
        }
    }

    @ReactMethod
    fun rescan(alias: String, height: Int, promise: Promise) {
        val wallet = getWallet(alias)
        moduleScope.launch {
            wallet.rewindToNearestHeight(BlockHeight.new(wallet.network, height.toLong()))
        }
    }

    @ReactMethod
    fun deriveViewingKey(seedBytesHex: String, network: String = "mainnet", promise: Promise) {
        var keys = runBlocking { DerivationTool.getInstance().deriveUnifiedFullViewingKeys(seedBytesHex.fromHex(), networks.getOrDefault(network, ZcashNetwork.Mainnet), DerivationTool.DEFAULT_NUMBER_OF_ACCOUNTS)[0] }
        val map = Arguments.createMap()
        map.putString("extfvk", keys.encoding)
        map.putString("extpub", "")
        promise.resolve(map)
    }

    @ReactMethod
    fun deriveSpendingKey(seedBytesHex: String, network: String = "mainnet", promise: Promise) = promise.wrap {
        val spendingKey = runBlocking { DerivationTool.getInstance().deriveUnifiedSpendingKey(seedBytesHex.fromHex(), networks.getOrDefault(network, ZcashNetwork.Mainnet), Account.DEFAULT) }
        return@wrap String(spendingKey.copyBytes(), Charsets.UTF_8)
    }

    //
    // Properties
    //


    @ReactMethod
    fun getLatestNetworkHeight(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        return@wrap wallet.latestHeight
    }

    @ReactMethod
    fun getBirthdayHeight(host: String, port: Int, promise: Promise) {
        moduleScope.launch {
            promise.wrap {
                var endpoint = LightWalletEndpoint(host, port, true)
                var lightwalletService = LightWalletClient.new(reactApplicationContext, endpoint)
                return@wrap when (val response = lightwalletService.getLatestBlockHeight()) {
                    is Response.Success -> {
                        response.result.value.toInt()
                    }

                    is Response.Failure -> {
                        throw LightWalletException.DownloadBlockException(
                            response.code,
                            response.description,
                            response.toThrowable()
                        )
                    }
                }
            }
        }
    }

    @ReactMethod
    fun getBalance(alias: String, promise: Promise) = promise.wrap {
        val wallet = getWallet(alias)
        var availableZatoshi = Zatoshi(0L)
        var totalZatoshi = Zatoshi(0L)

        val transparentBalances = wallet.transparentBalances.value
        availableZatoshi.plus(transparentBalances?.available ?: Zatoshi(0L))
        totalZatoshi.plus(transparentBalances?.total ?: Zatoshi(0L))

        val saplingBalances = wallet.saplingBalances.value
        availableZatoshi.plus(saplingBalances?.available ?: Zatoshi(0L))
        totalZatoshi.plus(saplingBalances?.total ?: Zatoshi(0L))

        val orchardBalances = wallet.orchardBalances.value
        availableZatoshi.plus(orchardBalances?.available ?: Zatoshi(0L))
        totalZatoshi.plus(orchardBalances?.total ?: Zatoshi(0L))



        val map = Arguments.createMap()
        map.putString("totalZatoshi", totalZatoshi.value.toString())
        map.putString("availableZatoshi", availableZatoshi.value.toString())
        return@wrap map
    }

    @ReactMethod
    fun spendToAddress(
        alias: String,
        zatoshi: String,
        toAddress: String,
        memo: String,
        fromAccountIndex: Int,
        seed: String,
        promise: Promise
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            val usk = runBlocking { DerivationTool.getInstance().deriveUnifiedSpendingKey(seed.fromHex(), wallet.network, Account.DEFAULT) }
            try {
                val internalId = wallet.sendToAddress(
                    usk,
                    Zatoshi(zatoshi.toLong()),
                    toAddress,
                    memo
                )
                val tx = runBlocking { wallet.transactions.flatMapConcat { list -> flowOf(*list.toTypedArray()) } }.firstOrNull { item -> item.id == internalId }
                if (tx == null) throw Exception("transaction failed")

                val map = Arguments.createMap()
                map.putString("txId", tx.rawId.toString())
                if (tx.raw != null) map.putString("raw", tx.raw.toString())
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("Err", t)
            }
        }

    }

    //
    // AddressTool
    //

    @ReactMethod
    fun deriveUnifiedAddress(viewingKey: String, network: String = "mainnet", promise: Promise) = promise.wrap {
        return@wrap runBlocking { DerivationTool.getInstance().deriveUnifiedAddress(viewingKey, networks.getOrDefault(network, ZcashNetwork.Mainnet)) }
    }

    @ReactMethod
    fun isValidAddress(address: String, network: String, promise: Promise) {
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
    private fun getWallet(alias: String): SdkSynchronizer {
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
