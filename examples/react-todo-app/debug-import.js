console.log('Testing imports...')

import { DocumentStore, update } from '@commoncurriculum/storable'

console.log('DocumentStore:', typeof DocumentStore)
console.log('update:', typeof update)
console.log('update function:', update.toString().slice(0, 200))

const store = new DocumentStore()

// Create test document
const testDoc = { id: 'test-1', todos: [] }
store.setDocument('userTodoList', 'test-1', testDoc)

console.log('\nCalling update directly...')
try {
  const result = update(store, 'userTodoList', 'test-1', [
    { op: '$push', path: 'todos', value: { id: '1', text: 'Test' } }
  ])
  console.log('Update result:', result)
} catch (error) {
  console.log('Update error:', error)
}
