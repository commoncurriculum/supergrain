// Debug exactly what DocumentStore is returning
import { DocumentStore } from '../../src/core/store/DocumentStore.ts'
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Testing DocumentStore in detail...')

const store = new DocumentStore()

// Test 1: Set document then get signal
console.log('\n=== Test 1: Set document then get signal ===')
const doc = { id: 'test1', todos: ['a', 'b'] }
store.setDocument('test', 'test1', doc)

const signal1 = store.getDeepSignal('test', 'test1')
console.log('Signal1:', signal1)
console.log('Signal1 constructor:', signal1.constructor.name)
console.log('Signal1 prototype:', Object.getPrototypeOf(signal1).constructor.name)

// Check if it has alien-signals properties
const descriptors = Object.getOwnPropertyDescriptors(signal1)
console.log('Signal1 property descriptors:', Object.keys(descriptors))

// Check for hidden/symbol properties
const symbols = Object.getOwnPropertySymbols(signal1)
console.log('Signal1 symbols:', symbols.map(s => s.toString()))

try {
  const unwatch1 = watch(signal1, (value) => {
    console.log('Watch1 triggered with:', typeof value, value?.constructor?.name)
  }, { deep: true, immediate: true })
  console.log('✓ Test 1 signal is watchable')
  unwatch1()
} catch (e) {
  console.log('✗ Test 1 signal is not watchable:', e.message)
}

// Test 2: Get signal before setting document (empty signal)
console.log('\n=== Test 2: Get empty signal first ===')
const signal2 = store.getDeepSignal('test', 'test2')
console.log('Empty signal2:', signal2)
console.log('Empty signal2 _isEmpty:', signal2._isEmpty)

try {
  const unwatch2 = watch(signal2, (value) => {
    console.log('Watch2 triggered with:', typeof value, value?.constructor?.name)
  }, { deep: true, immediate: true })
  console.log('✓ Test 2 empty signal is watchable')
  unwatch2()
} catch (e) {
  console.log('✗ Test 2 empty signal is not watchable:', e.message)
}

// Test 3: Create reference signal to compare
console.log('\n=== Test 3: Reference signal ===')
const refSignal = deepSignal({ id: 'ref', todos: ['x', 'y'] })
console.log('Reference signal:', refSignal)
console.log('Reference constructor:', refSignal.constructor.name)

try {
  const unwatchRef = watch(refSignal, (value) => {
    console.log('WatchRef triggered with:', typeof value, value?.constructor?.name)
  }, { deep: true, immediate: true })
  console.log('✓ Reference signal is watchable')
  unwatchRef()
} catch (e) {
  console.log('✗ Reference signal is not watchable:', e.message)
}
