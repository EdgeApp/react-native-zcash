# React Native Zcash

## Unreleased

## 0.9.1 (2024-10-01)

- changed: Updated checkpoints

## 0.9.0 (2024-09-25)

- added: Support sending to ZIP-320 TEX addresses
- changed: Replace `sendToAddress` with `createTransfer`
- changed: Updated checkpoints

## 0.8.1 (2024-09-16)

- changed: Updated checkpoints

## 0.8.0 (2024-09-05)

- added: Add error listeners
- changed: Updated checkpoints

## 0.7.7 (2024-08-19)

- changed: Updated checkpoints

## 0.7.6 (2024-08-07)

- changed: Updated checkpoints

## 0.7.5 (2024-07-24)

- changed: Updated checkpoints
- fixed: Fix deriveViewingKey return value type

## 0.7.4 (2024-06-06)

- changed: Updated checkpoints

## 0.7.3 (2024-05-27)

- fixed: Add a missing header file to the podspec.

## 0.7.2 (2024-05-17)

- fixed: Pause synchronizer events until JavaScript is ready to receive them.

## 0.7.1 (2024-05-11)

- fixed: Stop depending on the iOS-provided SQLite, which causes crashes on iOS 13-15 because it is too old.

## 0.7.0 (2024-04-22)

- added: Support Orchard pool
- added: Support ZIP-317 fees
- changed: (Android) Upgrade zcash-android-sdk to v2.1.0
- changed: (iOS) Upgrade zcash-swift-wallet-sdk to v2.1.5
- changed: Updated checkpoints

## 0.6.14 (2024-04-12)

- fixed: Include missing Rust header file.

## 0.6.13 (2024-04-12)

- fixed: Update the packaging scripts to clean leftover files.
- fixed: Update the packaging scripts to correctly report errors, so we don't send failed packages to NPM.

## 0.6.12 (2024-04-10)

- fixed: Correct packaging mistake the previous release

## 0.6.11 (2024-04-10)

- changed: Updated checkpoints

## 0.6.10 (2024-03-27)

- changed: Updated checkpoints

## 0.6.9 (2024-03-12)

- changed: Updated checkpoints

## 0.6.8 (2024-02-23)

- changed: Updated checkpoints
- fixed: (android) Wrap sdk methods in try/catch to prevent native crashes

## 0.6.7 (2024-02-13)

- changed: Updated checkpoints

## 0.6.6 (2024-01-14)

- changed: Updated checkpoints

## 0.6.5 (2023-11-03)

- changed: Updated checkpoints

## 0.6.4 (2023-10-20)

- changed: (iOS) Upgrade ZcashLightClientKit to v2.0.3
- removed: (iOS) Remove transaction workaround added previously in v0.6.3

## 0.6.3 (2023-10-19)

iOS:

- changed: Emit all txs the first time the synchronizer says it's synced. This is a workaround for the synchronizer not publishing some transactions
- fixed: Fix fee amount returned with transaction.

## 0.6.2 (2023-10-16)

- changed: Upgrade ZcashLightClientKit to v2.0.2
- changed: Make `rescan` async
- changed: Throttle sync status to only report changes (iOS)

## 0.6.1 (2023-10-11)

- added: Add `shieldFunds` support
- changed: Package now exports types
- deprecated: Balance event fields `availableZatoshi` and `totalZatoshi`

Android

- changed: Various syntax cleanups
- fixed: Transactions event now returns confirmed and pending (<10 confirmations) transactions

## 0.6.0 (2023-10-10)

- added: Balances and transactions are no longer queryable and are now emitted as updates are found
- changed: Upgrade zcash-android-sdk to v2.0.1
- changed: Upgrade ZcashLightClientKit to v2.0.1
- changed: Return `raw` and `fee` with transactions
- removed: `getBalance` and `getTransactions`

Android:

- changed: Various syntax cleanups

iOS:

- fixed: Restart synchronizer on rescan
- fixed: Txid parsing

## 0.5.0 (2023-09-20)

- changed: `deriveUnifiedAddress` will now return all three address types
- changed: Replace `runBlocking` with async/await (Android)
- fixed: Rewrite `getTransactions` (Android)
- fixed: Force balance refresh before grabbing balances in `getBalance` (workaround for bug in SDK) (Android)

## 0.4.2 (2023-09-14)

- changed: Always return memos array with transactions
- changed: Simplify compactMap transform

## 0.4.1 (2023-09-13)

- fixed: Update checkpoint path (Android)
- fixed: Fix view key derivation (Android)
- fixed: Fix `getTransactions` early exit (Android)
- fixed: Fix hex string handling (Android)
- fixed: Fix recipient address availability assumption (iOS)

## 0.4.0 (2023-09-04)

- changed: Upgrade zcash-android-sdk to v1.20.0-beta01
- changed: Upgrade ZcashLightClientKit to v0.22.0-beta
- changed: Repackage `KoyTool` and `AddressTool` methods synchronizer-independent `Tools`

## 0.3.5 (2023-08-03)

- fixed: Update our default Kotlin version to be compatible with React Native v0.72.
- changed: Remove our iOS dependency on ZCashLightClientKit by copying the Swift sources directly into this NPM package. This removes the need for users to touch checkpoints on either platform.

## 0.3.4 (2023-07-27)

- added: Add checkpoints to repo with script to update and copy them from Android to iOS build directories
- changed: Proper install instructions for Android in README

## 0.3.3 (2023-06-22)

- fixed: Update the Android build.gradle to use the upstream-specified Kotlin version and upstream-specified appcompat library version.

## 0.3.2 (2022-12-20)

- getBirthdayHeight: Remove Android specific network name and use host and port for both platforms

## 0.3.1 (2022-12-15)

- Add `getBirthdayHeight` method to query blockheight without an active synchronizer
- iOS: Add missing `getLatestNetworkHeight` method
- RN: Remove unimplemented methods and POC comments
- Fix exported types

## 0.2.3 (2022-08-07)

- iOS: Handle potential throw in synchronizer.latestHeight()

## 0.2.2 (2022-06-10)

- Upgrade SDKs to NU5 compatible versions
  - Android: Upgrade zcash-android-sdk to v1.5.0-beta01
  - iOS: Upgrade ZcashLightClientKit to v0.14.0-beta
- iOS: Fix memory leak after stopping synchronizer
- ANdroid: White space and import cleanups

## 0.2.1 (2022-03-16)

- Update the ZcashLightClientKit dependency
- Remove unused build scripts

## 0.2.0 (2022-01-10)

- Add iOS support
- Android: Cleanup unused methods

## 0.1.0 (2021-11-09)

- Initial release

## 0.0.2

- Add stubs for deriveViewKey and getShieldedBalance

## 0.0.1

- Initial release
