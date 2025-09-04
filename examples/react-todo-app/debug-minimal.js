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

console.log('Setting initial document...')
store.setDocument('userTodoList', 'test-1', testDoc)

console.log('Getting document back:', store.getDocument('userTodoList', 'test-1'))

console.log('\nTesting $push operation...')
const newTodo = { id: '3', text: 'Todo 3', completed: false }
update(store, 'userTodoList', 'test-1', [
  { op: '$push', path: 'todos', value: newTodo }
])

console.log('Document after $push:', store.getDocument('userTodoList', 'test-1'))

console.log('\nTesting $set operation...')
update(store, 'userTodoList', 'test-1', [
  { op: '$set', path: 'todos.0.completed', value: true }
])

console.log('Document after $set:', store.getDocument('userTodoList', 'test-1'))
