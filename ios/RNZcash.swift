import Foundation
import ZcashLightClientKit

let DerivationTools = ["mainnet": DerivationTool(networkType:ZcashNetworkBuilder.network(for: .mainnet).networkType), "testnet": DerivationTool(networkType:ZcashNetworkBuilder.network(for: .testnet).networkType)]

// Used when calling reject where there isn't an error object
let genericError = NSError(domain: "", code: 0)

@objc(RNZcash)
class RNZcash : NSObject {


    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // Derivation Tool
    @objc func deriveViewingKey(_ seed: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let viewingKeys: [UnifiedViewingKey] = try? DerivationTools[network]?.deriveUnifiedViewingKeysFromSeed(seed.hexaBytes, numberOfAccounts:1) {
            let out = ["extfvk": viewingKeys[0].extfvk, "extpub": viewingKeys[0].extpub]
            resolve(out);
        } else {
            reject("DeriveViewingKeyError", "Failed to derive viewing key", genericError)
        }
    }

    @objc func deriveSpendingKey(_ seed: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let spendingKeys: [String] = try? DerivationTools[network]?.deriveSpendingKeys(seed:seed.hexaBytes, numberOfAccounts:1) {
            resolve(spendingKeys[0]);
        } else {
            reject("DeriveSpendingKeyError", "Failed to derive spending key", genericError)
        }
    }

    @objc func deriveShieldedAddress(_ viewingKey: String, _ network: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) -> Void {
        if let address: String = try? DerivationTools[network]?.deriveShieldedAddress(viewingKey:viewingKey) {
            resolve(address);
        } else {
            reject("DeriveShieldedAddressError", "Failed to derive shielded address", genericError)
        }
    }
}

// Convert hex strings to [UInt8]
extension StringProtocol {
    var hexaData: Data { .init(hexa) }
    var hexaBytes: [UInt8] { .init(hexa) }
    private var hexa: UnfoldSequence<UInt8, Index> {
        sequence(state: startIndex) { startIndex in
            guard startIndex < self.endIndex else { return nil }
            let endIndex = self.index(startIndex, offsetBy: 2, limitedBy: self.endIndex) ?? self.endIndex
            defer { startIndex = endIndex }
            return UInt8(self[startIndex..<endIndex], radix: 16)
        }
    }
}
