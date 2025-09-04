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

// Get signal before update
const signalBefore = store.getDeepSignal('userTodoList', 'test-1')
console.log('2. Signal before update - todos length:', signalBefore.todos.length)
console.log('   Signal object id:', signalBefore)

console.log('\n3. Running update...')
const newTodo = { id: '3', text: 'Todo 3', completed: false }
update(store, 'userTodoList', 'test-1', [
  { op: '$push', path: 'todos', value: newTodo }
])

// Get signal after update
const signalAfter = store.getDeepSignal('userTodoList', 'test-1')
console.log('4. Signal after update - todos length:', signalAfter.todos.length)
console.log('   Signal object id:', signalAfter)
console.log('   Same signal object?', signalBefore === signalAfter)

console.log('\n5. Document via getDocument:', JSON.stringify(store.getDocument('userTodoList', 'test-1'), null, 2))
