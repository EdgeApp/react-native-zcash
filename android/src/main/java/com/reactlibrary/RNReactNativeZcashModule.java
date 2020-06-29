
package com.reactlibrary;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Callback;

public class RNReactNativeZcashModule extends ReactContextBaseJavaModule {

  private final ReactApplicationContext reactContext;

  public RNReactNativeZcashModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return "RNReactNativeZcash";
  }

  @ReactMethod
  public void getNumTransactions(
          Integer N,
          Promise promise) {
    try {
      promise.resolve(N+43);
    } catch (Exception e) {
      promise.reject("Err", e);
    }
  }
}
