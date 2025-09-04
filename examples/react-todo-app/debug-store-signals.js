// Test DocumentStore deep signal creation
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Testing DocumentStore-style deep signal creation...')

// Simulate what DocumentStore.getDeepSignal does
const existingDocument = {
  id: 'test',
  todos: ['item1', 'item2']
}

// This is what DocumentStore does
const initialValue = existingDocument
  ? JSON.parse(JSON.stringify(existingDocument))
  : {}

console.log('1. Initial value:', initialValue)

// Create deep signal like DocumentStore does
const deepSig = deepSignal(initialValue)
console.log('2. Deep signal created:', deepSig)

// Try to watch it
try {
  let watchCount = 0
  const unwatch = watch(deepSig, (value) => {
    watchCount++
    console.log(`3.${watchCount}. Watch triggered! Value:`, value)
  }, {
    deep: true,
    immediate: true
  })

  setTimeout(() => {
    console.log('4. Modifying signal...')
    deepSig.todos.push('item3')

    setTimeout(() => {
      console.log('5. Final todos:', deepSig.todos.length)
      console.log('6. Watch called', watchCount, 'times')
      unwatch()
    }, 100)
  }, 100)

} catch (error) {
  console.error('Error watching signal:', error)
}
