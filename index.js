
import { NativeModules } from 'react-native';

const { RNReactNativeZcash } = NativeModules;

export async function getNumTransactions (n) {
  console.log('RNReactNativeZcash:',RNReactNativeZcash)
  return await RNReactNativeZcash.getNumTransactions(n)
}

export default {
  getNumTransactions
}
