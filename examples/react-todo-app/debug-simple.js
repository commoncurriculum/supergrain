// Simple test of alien-deepsignals
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Testing basic alien-deepsignals functionality...')

// Create a simple deep signal
const state = deepSignal({
  count: 0,
  todos: ['item1', 'item2']
})

console.log('1. Created deep signal:', state)
console.log('2. Initial todos count:', state.todos.length)

// Watch it
let watchCount = 0
const unwatch = watch(state, (value) => {
  watchCount++
  console.log(`3.${watchCount}. Watch triggered! Todos:`, value.todos.length)
}, {
  deep: true,
  immediate: true
})

// Modify it
setTimeout(() => {
  console.log('4. Adding todo...')
  state.todos.push('item3')

  setTimeout(() => {
    console.log('5. Final state:', state.todos.length, 'todos')
    console.log('6. Watch was called', watchCount, 'times')
    unwatch()
  }, 100)
}, 100)
