// Test our DocumentStore update function specifically
import { DocumentStore, update } from '../../src/core/store/DocumentStore.ts'
import { watch } from 'alien-deepsignals'

console.log('Testing DocumentStore update function...')

const store = new DocumentStore()

// Set initial document
const initialDoc = {
  id: 'test',
  todos: [
    { id: '1', text: 'First', completed: false },
    { id: '2', text: 'Second', completed: false }
  ]
}

store.setDocument('test', 'test', initialDoc)
const deepSignal = store.getDeepSignal('test', 'test')

let updateCount = 0
const unwatch = watch(deepSignal, (value) => {
  updateCount++
  console.log(`Update #${updateCount}: ${value.todos?.length || 0} todos`)
  if (value.todos && value.todos.length > 0) {
    const lastTodo = value.todos[value.todos.length - 1]
    console.log(`  Last todo: "${lastTodo.text}" (${lastTodo.completed ? 'done' : 'pending'})`)
  }
}, {
  deep: true,
  immediate: true
})

console.log('\n1. Testing $push operation...')
setTimeout(() => {
  update(store, 'test', 'test', [
    { op: '$push', path: 'todos', value: { id: '3', text: 'Third', completed: false } }
  ])
}, 100)

console.log('\n2. Testing $set operation...')
setTimeout(() => {
  update(store, 'test', 'test', [
    { op: '$set', path: 'todos.0.completed', value: true },
    { op: '$set', path: 'todos.0.text', value: 'First (updated)' }
  ])
}, 200)

console.log('\n3. Testing $pull operation...')
setTimeout(() => {
  const todoToRemove = deepSignal.todos.find(t => t.id === '2')
  if (todoToRemove) {
    update(store, 'test', 'test', [
      { op: '$pull', path: 'todos', value: todoToRemove }
    ])
  }
}, 300)

setTimeout(() => {
  console.log(`\nFinal result: ${updateCount} updates total`)
  if (deepSignal.todos) {
    console.log('Final todos:')
    deepSignal.todos.forEach((todo, i) => {
      console.log(`  ${i + 1}. [${todo.completed ? '✓' : ' '}] ${todo.text}`)
    })
  }
  unwatch()
}, 500)
