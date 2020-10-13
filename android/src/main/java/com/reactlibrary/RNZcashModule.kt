package com.reactlibrary;

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter

class RNZcashModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "RNZcash"

  @ReactMethod
  fun getNumTransactions(
    N: Float,
    promise: Promise
  ) {
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
      val params = Arguments.createMap()
      params.putString("foo", "bar3")
      sendEvent(reactContext, "FooEvent", params)
      try {
        Thread.sleep(20000)
      } catch (e: InterruptedException) {
        //do nothing
      }
      promise.resolve(N + 43)
    } catch (e: Exception) {
      promise.reject("Err", e)
    }
  }

  @ReactMethod
  fun deriveViewKey(
    seedBytesHex: String,
    promise: Promise
  ) {
    try {
      promise.resolve("$seedBytesHex-viewKey930club")
    } catch (e: Exception) {
      promise.reject("Err", e)
    }
  }

  @ReactMethod
  fun getShieldedBalance(
    promise: Promise
  ) {
    try {
      val params = Arguments.createMap()
      params.putString("availableBalance", "123")
      params.putString("totalBalance", "1234")
      promise.resolve(params)
    } catch (e: Exception) {
      promise.reject("Err", e)
    }
  }

  private fun sendEvent(
    reactContext: ReactContext,
    eventName: String,
    params: WritableMap
  ) {
    reactContext
      .getJSModule(RCTDeviceEventEmitter::class.java)
      .emit(eventName, params)
  }
}
