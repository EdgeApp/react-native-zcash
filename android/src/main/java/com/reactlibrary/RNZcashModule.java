package com.reactlibrary;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;




public class RNZcashModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  public RNZcashModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return "RNZcash";
  }

  @ReactMethod
  public void getNumTransactions(
          Float N,
          Promise promise) {
    try {
//      (new Runnable(){
//        @Override
//        public void run() {
//          WritableMap params = Arguments.createMap();
//          params.putString("foo", "bar");
//          try {
//            Thread.sleep(20000);
//          }catch(InterruptedException e) {
//            //do nothing
//          }
//          sendEvent(reactContext, "FooEvent", params);
//        }
//      }).run();
        WritableMap params = Arguments.createMap();
        params.putString("foo", "bar3");
      sendEvent(reactContext, "FooEvent", params);
        try {
            Thread.sleep(20000);
        }catch(InterruptedException e) {
        //do nothing
        }
      promise.resolve(N+43);
    } catch (Exception e) {
      promise.reject("Err", e);
    }
  }
    private void sendEvent(ReactContext reactContext,
                         String eventName,
                         WritableMap params) {
    reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);

}
}
