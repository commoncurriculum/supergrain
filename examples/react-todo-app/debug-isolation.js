// Isolate the exact issue with alien-deepsignals
import { deepSignal, watch } from 'alien-deepsignals'

console.log('=== Testing alien-deepsignals behavior step by step ===')

// Step 1: Basic signal creation and watching
console.log('\n1. Basic signal creation and watch:')
const signal1 = deepSignal({ count: 0 })
console.log('Signal1 created:', signal1)

try {
  const unwatch1 = watch(signal1, () => console.log('Signal1 changed'), { deep: true })
  console.log('✓ Signal1 is watchable')
  unwatch1()
} catch (e) {
  console.log('✗ Signal1 not watchable:', e.message)
}

// Step 2: Signal with _isEmpty property (like our DocumentStore)
console.log('\n2. Signal with _isEmpty property:')
const signal2 = deepSignal({})
signal2._isEmpty = true
console.log('Signal2 created with _isEmpty:', signal2)

try {
  const unwatch2 = watch(signal2, () => console.log('Signal2 changed'), { deep: true })
  console.log('✓ Signal2 with _isEmpty is watchable')
  unwatch2()
} catch (e) {
  console.log('✗ Signal2 with _isEmpty not watchable:', e.message)
}

// Step 3: Replacing signal like setDocument does
console.log('\n3. Replacing signal like setDocument:')
const signalMap = new Map()
const key = 'test:key'

// First create empty signal
const emptySignal = deepSignal({})
emptySignal._isEmpty = true
signalMap.set(key, emptySignal)
console.log('Empty signal stored:', emptySignal)

// Then replace it like setDocument does
const data = { id: 'test', todos: ['a', 'b'] }
const newSignal = deepSignal(JSON.parse(JSON.stringify(data)))
signalMap.set(key, newSignal)
console.log('New signal stored:', newSignal)

// Try to watch the new signal
const retrievedSignal = signalMap.get(key)
console.log('Retrieved signal:', retrievedSignal)
console.log('Retrieved signal type:', typeof retrievedSignal)
console.log('Retrieved signal constructor:', retrievedSignal.constructor.name)

try {
  const unwatch3 = watch(retrievedSignal, () => console.log('Retrieved signal changed'), { deep: true })
  console.log('✓ Retrieved signal is watchable')
  unwatch3()
} catch (e) {
  console.log('✗ Retrieved signal not watchable:', e.message)
}

// Step 4: Test exact DocumentStore sequence
console.log('\n4. Exact DocumentStore sequence:')
class TestStore {
  signals = new Map()

  getKey(type, id) {
    return `${type}:${id}`
  }

  getDeepSignal(type, id) {
    const key = this.getKey(type, id)
    if (!this.signals.has(key)) {
      const deepSig = deepSignal({})
      deepSig._isEmpty = true
      this.signals.set(key, deepSig)
    }
    return this.signals.get(key)
  }

  setDocument(type, id, document) {
    const key = this.getKey(type, id)
    const deepSig = deepSignal(JSON.parse(JSON.stringify(document)))
    this.signals.set(key, deepSig)
  }
}

const testStore = new TestStore()

// First get empty signal
const signal4 = testStore.getDeepSignal('user', '1')
console.log('Empty signal from store:', signal4)

// Then set document
testStore.setDocument('user', '1', { id: '1', name: 'Test' })

// Get signal again
const signal5 = testStore.getDeepSignal('user', '1')
console.log('Signal after setDocument:', signal5)

try {
  const unwatch5 = watch(signal5, () => console.log('Store signal changed'), { deep: true })
  console.log('✓ Store signal is watchable')
  unwatch5()
} catch (e) {
  console.log('✗ Store signal not watchable:', e.message)
}
