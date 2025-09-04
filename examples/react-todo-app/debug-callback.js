// Test the watch callback behavior
import { deepSignal, watch } from 'alien-deepsignals'

console.log('=== Testing watch callback behavior ===')

const state = deepSignal({
  count: 0,
  todos: ['item1', 'item2']
})

console.log('1. Initial state:', state)

console.log('\n2. Setting up watch...')
const unwatch = watch(state, (value) => {
  console.log('Watch callback triggered:')
  console.log('  - value type:', typeof value)
  console.log('  - value constructor:', value?.constructor?.name)
  console.log('  - value:', value)
  console.log('  - state (direct):', state)
  console.log('  - state === value:', state === value)
}, {
  deep: true,
  immediate: true
})

console.log('\n3. Modifying state...')
setTimeout(() => {
  state.count = 1
  state.todos.push('item3')
}, 100)

setTimeout(() => {
  console.log('\n4. Final state:', state)
  unwatch()
}, 200)
