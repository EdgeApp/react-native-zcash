# React Native Zcash

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
