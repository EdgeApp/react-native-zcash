// Formatted using clang-format with default settings.

#import "RNZcash.h"

@implementation RNZcash

RCT_EXPORT_MODULE()

// - (id)init {
//   self = [super init];
//   return self;
// }

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_REMAP_METHOD(getNumTransactions, getNumTransactions:(float) N
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
//     NSUInteger const onehundred = 100;
//     NSNumber *val = [NSNumber numberWithInteger:(N+42)];
    NSNumber *myNum = [NSNumber numberWithFloat:(N+123)];
    resolve(myNum);
}

@end
