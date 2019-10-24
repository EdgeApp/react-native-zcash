
import { NativeModules } from 'react-native';

const { RNZcash } = NativeModules;

export async function getNumTransactions (n) {
  console.log('RNZcash:',RNZcash)
  return await RNZcash.getNumTransactions(n)
}

