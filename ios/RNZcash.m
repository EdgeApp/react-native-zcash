
#import "RNZcash.h"

@implementation RNZcash

- (dispatch_queue_t)methodQueue
{
    return dispatch_get_main_queue();
}
RCT_EXPORT_MODULE()

RCT_REMAP_METHOD(getNumTransactions, getNumTransactions:(NSUInteger *) N
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
//     NSUInteger const onehundred = 100;
//     NSNumber *val = [NSNumber numberWithInteger:(N+42)];
    NSNumber *myNum = [NSNumber numberWithInteger:(N+123)];
    resolve(myNum);
}

@end
