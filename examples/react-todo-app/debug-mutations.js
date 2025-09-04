// Test if mutations trigger watch properly
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Testing alien-deepsignals mutations...')

const state = deepSignal({
  todos: [
    { id: '1', text: 'First', completed: false },
    { id: '2', text: 'Second', completed: false }
  ]
})

let updateCount = 0
const unwatch = watch(state, (value) => {
  updateCount++
  console.log(`Update #${updateCount}: ${value.todos.length} todos`)
  if (updateCount > 1) {
    const lastTodo = value.todos[value.todos.length - 1]
    console.log(`  Last todo: "${lastTodo.text}"`)
  }
}, {
  deep: true,
  immediate: true
})

console.log('\n1. Testing array.push...')
setTimeout(() => {
  state.todos.push({ id: '3', text: 'Third', completed: false })
}, 100)

console.log('\n2. Testing direct property mutation...')
setTimeout(() => {
  state.todos[0].completed = true
  state.todos[0].text = 'First (updated)'
}, 200)

console.log('\n3. Testing array.splice (removal)...')
setTimeout(() => {
  state.todos.splice(1, 1) // Remove second item
}, 300)

setTimeout(() => {
  console.log(`\nFinal: ${updateCount} updates total`)
  console.log('Final state:', state.todos.map(t => `${t.text} (${t.completed ? 'done' : 'pending'})`))
  unwatch()
}, 500)
