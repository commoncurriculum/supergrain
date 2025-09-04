import { DocumentStore } from './dist/index.mjs'

console.log('Testing DocumentStore to reproduce the error...')

const store = new DocumentStore()

// Test data similar to what the React app uses
const testDoc = {
  id: 'user-1',
  userId: 'user-1',
  firstName: 'John',
  lastName: 'Doe',
  todos: [
    {
      id: '1',
      text: 'Test todo',
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

try {
  console.log('1. Setting document...')
  store.setDocument('userTodoList', 'user-1', testDoc)

  console.log('2. Getting document signal...')
  const signal = store.getDocumentSignal('userTodoList', 'user-1')

  console.log('3. Accessing signal.value...')
  console.log('Signal value:', signal.value)

  console.log('4. Getting deep signal...')
  const deepSig = store.getDeepSignal('userTodoList', 'user-1')
  console.log('Deep signal:', deepSig)
  console.log('Deep signal value:', deepSig.value)
} catch (error) {
  console.error('Error occurred:', error.message)
  console.error('Stack:', error.stack)
}
