#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>


@interface RCT_EXTERN_MODULE(RNZcash, RCTEventEmitter<RCTBridgeModule>)

// Synchronizer
RCT_EXTERN_METHOD(initialize:(NSString *)extfvk
:(NSString *)extpub
:(NSInteger *)birthdayHeight
:(NSString *)alias
:(NSString *)networkName
:(NSString *)defaultHost
:(NSInteger *)defaultPort
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(start:(NSString *)alias
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(stop:(NSString *)alias
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(getLatestNetworkHeight:(NSString *)alias
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(spendToAddress:(NSString *)alias
:(NSString *)zatoshi
:(NSString *)toAddress
:(NSString *)memo
:(NSInteger *)fromAccountIndex
:(NSString *)spendingKey
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(getTransactions:(NSString *)alias
:(NSInteger *)first
:(NSInteger *)last
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(getShieldedBalance:(NSString *)alias
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(rescan:(NSString *)alias
:(NSInteger *)height
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

// Derivation tool
RCT_EXTERN_METHOD(deriveViewingKey:(NSString *)seed
:(NSString *)network
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(deriveSpendingKey:(NSString *)seed
:(NSString *)network
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(deriveShieldedAddress:(NSString *)viewingKey
:(NSString *)network
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(isValidTransparentAddress:(NSString *)address
:(NSString *)network
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(isValidShieldedAddress:(NSString *)address
:(NSString *)network
resolver:(RCTPromiseResolveBlock)resolve
rejecter:(RCTPromiseRejectBlock)reject
)

// Events
RCT_EXTERN_METHOD(supportedEvents)

@end
