
import { NativeEventEmitter, NativeModules } from 'react-native';

const { RNZcash } = NativeModules;

export async function getNumTransactions (n) {
  return await RNZcash.getNumTransactions(n)
}

export async function subscribeToFoo (callback) {
  const eventEmitter = new NativeEventEmitter(RNZcash);
  const subscription = eventEmitter.addListener('FooEvent', callback);
}

