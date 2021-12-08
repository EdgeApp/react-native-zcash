#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(RNZcash, NSObject)

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