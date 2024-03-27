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
import co.electriccoin.lightwallet.client.new
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class RNZcashModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
    /**
     * Scope for anything that out-lives the synchronizer, meaning anything that can be used before
     * the synchronizer starts or after it stops. Everything else falls within the scope of the
     * synchronizer and should use `synchronizer.coroutineScope` whenever a scope is needed.
     */
    private var moduleScope: CoroutineScope = CoroutineScope(Dispatchers.IO)
    private var synchronizerMap = mutableMapOf<String, SdkSynchronizer>()

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
    ) = moduleScope.launch {
        promise.wrap {
            val network = networks.getOrDefault(networkName, ZcashNetwork.Mainnet)
            val endpoint = LightWalletEndpoint(defaultHost, defaultPort, true)
            val seedPhrase = SeedPhrase.new(seed)
            val initMode = if (newWallet) WalletInitMode.NewWallet else WalletInitMode.ExistingWallet
            if (!synchronizerMap.containsKey(alias)) {
                synchronizerMap[alias] =
                    Synchronizer.new(
                        reactApplicationContext,
                        network,
                        alias,
                        endpoint,
                        seedPhrase.toByteArray(),
                        BlockHeight.new(network, birthdayHeight.toLong()),
                        initMode,
                    ) as SdkSynchronizer
            }
            val wallet = getWallet(alias)
            val scope = wallet.coroutineScope
            combine(wallet.progress, wallet.networkHeight) { progress, networkHeight ->
                return@combine mapOf("progress" to progress, "networkHeight" to networkHeight)
            }.collectWith(scope) { map ->
                val progress = map["progress"] as PercentDecimal
                var networkBlockHeight = map["networkHeight"] as BlockHeight?
                if (networkBlockHeight == null) networkBlockHeight = BlockHeight.new(wallet.network, birthdayHeight.toLong())

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
            wallet.transactions.collectWith(scope) { txList ->
                scope.launch {
                    val nativeArray = Arguments.createArray()
                    txList.filter { tx -> tx.transactionState != TransactionState.Expired }.map { tx ->
                        launch {
                            val parsedTx = parseTx(wallet, tx)
                            nativeArray.pushMap(parsedTx)
                        }
                    }.forEach { it.join() }

                    sendEvent("TransactionEvent") { args ->
                        args.putString("alias", alias)
                        args.putArray(
                            "transactions",
                            nativeArray,
                        )
                    }
                }
            }
            combine(
                wallet.transparentBalance,
                wallet.saplingBalances,
                wallet.orchardBalances,
            ) { transparentBalance, saplingBalances, orchardBalances ->
                return@combine mapOf(
                    "transparentBalance" to transparentBalance,
                    "saplingBalances" to saplingBalances,
                    "orchardBalances" to orchardBalances,
                )
            }.collectWith(scope) { map ->
                val transparentBalance = map["transparentBalance"] as Zatoshi?
                val saplingBalances = map["saplingBalances"] as WalletBalance?
                val orchardBalances = map["orchardBalances"] as WalletBalance?

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
            return@wrap null
        }
    }

    @ReactMethod
    fun stop(
        alias: String,
        promise: Promise,
    ) {
        promise.wrap {
            val wallet = getWallet(alias)
            wallet.close()
            synchronizerMap.remove(alias)
            return@wrap null
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
                if (tx.feePaid != null) {
                    map.putString("fee", tx.feePaid!!.value.toString())
                }
                map.putInt("minedHeight", tx.minedHeight?.value?.toInt() ?: 0)
                map.putInt("blockTimeInSeconds", tx.blockTimeEpochSeconds?.toInt() ?: 0)
                map.putString("rawTransactionId", tx.rawId.byteArray.toHexReversed())
                if (tx.raw != null) {
                    map.putString("raw", tx.raw!!.byteArray.toHex())
                }
                if (tx.isSentTransaction) {
                    try {
                        val recipient = wallet.getRecipients(tx).first()
                        if (recipient is TransactionRecipient.Address) {
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
        wallet.coroutineScope.launch {
            promise.wrap {
                wallet.rewindToNearestHeight(wallet.latestBirthdayHeight)
                return@wrap null
            }
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
                }
            }
        }
    }

    @ReactMethod
    fun sendToAddress(
        alias: String,
        zatoshi: String,
        toAddress: String,
        memo: String = "",
        seed: String,
        promise: Promise,
    ) {
        val wallet = getWallet(alias)
        wallet.coroutineScope.launch {
            try {
                val seedPhrase = SeedPhrase.new(seed)
                val usk = DerivationTool.getInstance().deriveUnifiedSpendingKey(seedPhrase.toByteArray(), wallet.network, Account.DEFAULT)
                val internalId =
                    wallet.sendToAddress(
                        usk,
                        Zatoshi(zatoshi.toLong()),
                        toAddress,
                        memo,
                    )
                val tx = wallet.coroutineScope.async { wallet.transactions.first().first() }.await()
                val map = Arguments.createMap()
                map.putString("txId", tx.rawId.byteArray.toHexReversed())
                if (tx.raw != null) map.putString("raw", tx.raw?.byteArray?.toHex())
                promise.resolve(map)
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
                val seedPhrase = SeedPhrase.new(seed)
                val usk = DerivationTool.getInstance().deriveUnifiedSpendingKey(seedPhrase.toByteArray(), wallet.network, Account.DEFAULT)
                val internalId =
                    wallet.shieldFunds(
                        usk,
                        memo,
                    )
                val tx = wallet.coroutineScope.async { wallet.transactions.first().first() }.await()
                val parsedTx = parseTx(wallet, tx)

                // Hack: Memos aren't ready to be queried right after broadcast
                val memos = Arguments.createArray()
                memos.pushString(memo)
                parsedTx.putArray("memos", memos)
                promise.resolve(parsedTx)
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
            promise.wrap {
                val unifiedAddress = wallet.getUnifiedAddress(Account(0))
                val saplingAddress = wallet.getSaplingAddress(Account(0))
                val transparentAddress = wallet.getTransparentAddress(Account(0))

                val map = Arguments.createMap()
                map.putString("unifiedAddress", unifiedAddress)
                map.putString("saplingAddress", saplingAddress)
                map.putString("transparentAddress", transparentAddress)
                return@wrap map
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
    private fun getWallet(alias: String): SdkSynchronizer {
        return synchronizerMap[alias] ?: throw Exception("Wallet not found")
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

    private fun ByteArray.toHexReversed(): String {
        val sb = StringBuilder(size * 2)
        var i = size - 1
        while (i >= 0)
            sb.append(String.format("%02x", this[i--]))
        return sb.toString()
    }
}
