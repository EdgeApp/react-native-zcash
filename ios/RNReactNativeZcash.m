
#import "RNReactNativeZcash.h"

@implementation RNReactNativeZcash

- (dispatch_queue_t)methodQueue
{
    return dispatch_get_main_queue();
}
RCT_EXPORT_MODULE()


RCT_REMAP_METHOD(getNumTransactions, getNumTransactions:(NSUInteger *)N
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
    resolve(N+42);
}

@end
