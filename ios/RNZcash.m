#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(RNZcash, NSObject)

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

@end