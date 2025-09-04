import { DocumentStore, update } from '@commoncurriculum/storable'

// Create a simple getValueAtPath function to test
function getValueAtPath(obj, path) {
  if (!path) {
    return obj
  }

  const pathParts = path.split('.')
  let current = obj

  for (const part of pathParts) {
    current = current[part]
    if (current === undefined || current === null) {
      return undefined
    }
  }

  return current
}

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

const signal = store.getDeepSignal('userTodoList', 'test-1')
console.log('2. Signal:', JSON.stringify(signal, null, 2))

console.log('\n3. Testing getValueAtPath...')
const todosRef = getValueAtPath(signal, 'todos')
console.log('todos ref:', todosRef)
console.log('Is array?', Array.isArray(todosRef))
console.log('Length:', todosRef?.length)
console.log('Same as signal.todos?', todosRef === signal.todos)

console.log('\n4. Testing direct mutation...')
console.log('Before push:', signal.todos.length)
todosRef.push({ id: '3', text: 'Todo 3', completed: false })
console.log('After push via ref:', signal.todos.length)
console.log('Signal todos now:', JSON.stringify(signal.todos, null, 2))
