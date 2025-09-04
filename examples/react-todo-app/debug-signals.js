import { DocumentStore, update } from '@commoncurriculum/storable'

// Simple test of store functionality
const store = new DocumentStore()

// Create test document
const testDoc = {
  id: 'test-1',
  todos: [
    { id: '1', text: 'Todo 1', completed: false },
    { id: '2', text: 'Todo 2', completed: false }
  ]
}

console.log('1. Setting initial document...')
store.setDocument('userTodoList', 'test-1', testDoc)

console.log('2. Getting document back:', JSON.stringify(store.getDocument('userTodoList', 'test-1'), null, 2))

console.log('3. Getting signal directly:')
const signal = store.getDeepSignal('userTodoList', 'test-1')
console.log('Signal value:', JSON.stringify(signal, null, 2))
console.log('Signal._isEmpty:', signal._isEmpty)

console.log('\n4. Testing $push operation directly on signal...')
const newTodo = { id: '3', text: 'Todo 3', completed: false }

console.log('Before push - signal.todos length:', signal.todos.length)
signal.todos.push(newTodo)
console.log('After push - signal.todos length:', signal.todos.length)
console.log('Signal todos:', JSON.stringify(signal.todos, null, 2))

console.log('\n5. Now testing via update function...')
const anotherTodo = { id: '4', text: 'Todo 4', completed: false }
update(store, 'userTodoList', 'test-1', [
  { op: '$push', path: 'todos', value: anotherTodo }
])

console.log('After update - signal.todos length:', signal.todos.length)
console.log('Document after update:', JSON.stringify(store.getDocument('userTodoList', 'test-1'), null, 2))
