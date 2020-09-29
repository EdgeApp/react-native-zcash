import { NativeEventEmitter, NativeModules } from 'react-native'

const { RNZcash } = NativeModules

export function getNumTransactions(n: number): Promise<number> {
  return RNZcash.getNumTransactions(n)
}

type Callback = (...args: any[]) => any

export function subscribeToFoo(callback: Callback): void {
  const eventEmitter = new NativeEventEmitter(RNZcash)
  eventEmitter.addListener('FooEvent', callback)
}
