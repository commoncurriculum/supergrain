import { deepSignal } from 'alien-deepsignals'

console.log('Testing alien-deepsignals deepSignal...')

const testData = {
  name: 'Test',
  value: 42,
  nested: {
    prop: 'hello'
  }
}

console.log('1. Creating deepSignal with data:', testData)
const signal = deepSignal(testData)

console.log('2. Signal object:', signal)
console.log('3. Signal.value:', signal.value)
console.log('4. Signal.name:', signal.name)
console.log('5. Signal properties:', Object.keys(signal))

// Test with null
console.log('\n6. Testing with null...')
const nullSignal = deepSignal(null)
console.log('7. Null signal:', nullSignal)
console.log('8. Null signal.value:', nullSignal.value)

// Test setting value
console.log('\n9. Setting signal.value to new data...')
signal.value = { name: 'Updated', value: 100 }
console.log('10. After setting, signal:', signal)
console.log('11. After setting, signal.value:', signal.value)
