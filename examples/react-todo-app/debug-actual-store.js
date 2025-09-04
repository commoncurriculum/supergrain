// Test the actual DocumentStore implementation
import { DocumentStore } from '../../src/core/store/DocumentStore.ts'
import { watch } from 'alien-deepsignals'

console.log('Testing actual DocumentStore...')

const store = new DocumentStore()

// Set a document
const document = {
  id: 'test',
  todos: ['item1', 'item2']
}

store.setDocument('test', 'test', document)
console.log('1. Set document in store')

// Get the deep signal
const deepSignal = store.getDeepSignal('test', 'test')
console.log('2. Got deep signal:', deepSignal)
console.log('3. Deep signal constructor:', deepSignal.constructor.name)
console.log('4. Deep signal prototype:', Object.getPrototypeOf(deepSignal))

// Try to watch it
try {
  let watchCount = 0
  const unwatch = watch(deepSignal, (value) => {
    watchCount++
    console.log(`5.${watchCount}. Watch triggered!`)
    console.log('     Value:', value)
  }, {
    deep: true,
    immediate: true
  })

  setTimeout(() => {
    console.log('6. Modifying deep signal...')
    deepSignal.todos.push('item3')

    setTimeout(() => {
      console.log('7. Final state:', deepSignal.todos.length, 'todos')
      console.log('8. Watch called', watchCount, 'times')
      unwatch()
    }, 100)
  }, 100)

} catch (error) {
  console.error('Error watching DocumentStore signal:', error)
  console.error('Signal type:', typeof deepSignal)
  console.error('Signal keys:', Object.keys(deepSignal))
}
