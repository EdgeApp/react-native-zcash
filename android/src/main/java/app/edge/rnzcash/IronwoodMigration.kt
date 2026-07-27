package app.edge.rnzcash

import cash.z.ecc.android.sdk.SdkSynchronizer
import cash.z.ecc.android.sdk.model.ZcashNetwork
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.util.Base64

/** Raised when a migration proposal cannot be quoted. */
class IronwoodMigrationException(
    message: String,
) : Exception(message)

/**
 * Orchard -> Ironwood (NU6.3) support.
 *
 * The sweep is one ordinary proposal the app broadcasts through the normal
 * `createTransfer` pipeline, mirroring the iOS bridge method for method,
 * because the JS API is the cross-platform contract.
 */
object IronwoodMigration {
    /**
     * NU6.3 activation heights, from ZIP 258 (final). Hardcoded for the same
     * reason `ZcashNetwork` hardcodes its Sapling and Orchard activation
     * heights: they are consensus constants, and neither SDK exposes an
     * Ironwood accessor. Replace if one ever appears.
     */
    private const val MAINNET_NU6_3_ACTIVATION_HEIGHT = 3_428_143L
    private const val TESTNET_NU6_3_ACTIVATION_HEIGHT = 4_134_000L

    /**
     * The NU6.3 activation height for the network, or null when it has none —
     * including a custom/darkside network, which carries its own heights.
     */
    fun ironwoodActivationHeight(network: ZcashNetwork): Long? =
        when {
            network.isMainnet() -> MAINNET_NU6_3_ACTIVATION_HEIGHT
            network.isTestnet() -> TESTNET_NU6_3_ACTIVATION_HEIGHT
            else -> null
        }

    /**
     * The Orchard-only sweep proposal, shaped as the JS
     * `ImmediateMigrationProposal` (`{ amountZatoshi, feeZatoshi, proposalBase64 }`).
     */
    suspend fun proposeOrchardToIronwoodMigration(synchronizer: SdkSynchronizer): WritableMap {
        val account =
            synchronizer.getAccounts().firstOrNull()
                ?: throw IronwoodMigrationException("No account found for this wallet")

        // Spends every Orchard note to the account's own internal receiver with
        // the fee chosen so no Orchard change remains, leaving Sapling and
        // transparent funds untouched. All-or-nothing: it throws rather than
        // migrating part of the balance, since post-NU6.3 the turnstile forbids
        // adding value back to Orchard and a remainder would be stranded.
        val proposal = synchronizer.proposeOrchardToIronwoodMigration(account)
        val feeZatoshi = proposal.totalFeeRequired().value

        // The proposal exposes its fee but not its payment value, so the amount
        // crossing is derived from what it consumes: the whole Orchard balance,
        // minus that fee. Fail rather than quote a quantity we cannot source —
        // this figure is displayed and then locked into the send scene.
        val orchardAvailable =
            synchronizer.walletBalances.value
                ?.get(account.accountUuid)
                ?.orchard
                ?.available
                ?.value
                ?: throw IronwoodMigrationException(
                    "Balances are not available yet; cannot quote the migration amount",
                )

        // The SDK built a fundable proposal, so a non-positive remainder means
        // the balance we read disagrees with the notes the proposal selected -
        // stale balances, or a differing notion of "available". Clamping that to
        // zero would quote a zero-amount migration against a real fee, and the
        // app locks this figure into the send scene. Fail loudly instead.
        val amountZatoshi = orchardAvailable - feeZatoshi
        if (amountZatoshi <= 0L) {
            throw IronwoodMigrationException(
                "Orchard balance ($orchardAvailable) does not cover the migration fee ($feeZatoshi)",
            )
        }

        return Arguments.createMap().apply {
            putString("amountZatoshi", amountZatoshi.toString())
            putString("feeZatoshi", feeZatoshi.toString())
            putString("proposalBase64", Base64.getEncoder().encodeToString(proposal.toByteArray()))
        }
    }
}
