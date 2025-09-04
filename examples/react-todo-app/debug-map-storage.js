// Test if Map storage breaks alien-deepsignals
import { deepSignal, watch } from 'alien-deepsignals'

console.log('=== Testing Map storage with alien-deepsignals ===')

const signalMap = new Map()

console.log('1. Create signal and store in Map:')
const originalSignal = deepSignal({ count: 0, todos: ['a', 'b'] })
console.log('Original signal:', originalSignal)

signalMap.set('test', originalSignal)
console.log('✓ Signal stored in Map')

console.log('\n2. Retrieve signal from Map:')
const retrievedSignal = signalMap.get('test')
console.log('Retrieved signal:', retrievedSignal)
console.log('Same reference:', originalSignal === retrievedSignal)

console.log('\n3. Test watch on retrieved signal:')
try {
  const unwatch = watch(retrievedSignal, (value) => {
    console.log('Retrieved signal callback:')
    console.log('  - value type:', typeof value)
    console.log('  - value:', value)
    console.log('  - retrievedSignal === value:', retrievedSignal === value)
  }, {
    deep: true,
    immediate: true
  })

  console.log('✓ Watch setup successful')

  setTimeout(() => {
    console.log('\n4. Modifying retrieved signal:')
    retrievedSignal.count = 1

    setTimeout(() => {
      console.log('Final signal state:', retrievedSignal)
      unwatch()
    }, 100)
  }, 100)

} catch (error) {
  console.log('✗ Watch setup failed:', error.message)
}
