
import { NativeModules } from 'react-native';

const { RNZcash } = NativeModules;

export async function getNumTransactions (n) {
  return await RNZcash.getNumTransactions(n)
}

