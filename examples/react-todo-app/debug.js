import { DocumentStore, update } from '@commoncurriculum/storable'

// Create test todo list
const createTodo = text => ({
  id: Math.random().toString(),
  text,
  completed: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const createUserTodoList = (userId, firstName, lastName) => {
  const now = Date.now()
  const defaultTodos = [
    createTodo('Learn React basics'),
    createTodo('Build a todo app'),
    createTodo('Deploy to production'),
  ]

  return {
    id: userId,
    userId,
    firstName,
    lastName,
    todos: defaultTodos,
    createdAt: now,
    updatedAt: now,
  }
}

const store = new DocumentStore()
const userList = createUserTodoList('test', 'Test', 'User')
store.setDocument('userTodoList', 'test', userList)

const signal = store.getDeepSignal('userTodoList', 'test')
console.log('Signal keys:', Object.keys(signal))

// Try to see if $todos exists
console.log('Has $todos:', '$todos' in signal)
console.log('signal.todos:', signal.todos)
console.log('signal.todos type:', typeof signal.todos)

if (signal.todos) {
  console.log('todos.value is array:', Array.isArray(signal.todos.value))
  console.log(
    'todos.currentValue is array:',
    Array.isArray(signal.todos.currentValue)
  )
  console.log(
    'todos length:',
    signal.todos.value?.length || signal.todos.currentValue?.length
  )
}

// Try the push operation
const newTodo = createTodo('New test todo')

try {
  console.log('Before push - signal.todos length:', signal.todos.length)
  console.log(
    'Before push - signal.todos is array:',
    Array.isArray(signal.todos)
  )

  update(signal, [{ op: '$push', path: 'todos', value: newTodo }])

  console.log('After push - signal.todos length:', signal.todos.length)
  console.log(
    'After push - signal.todos is array:',
    Array.isArray(signal.todos)
  )
  console.log(
    'Document todos length:',
    store.getDocument('userTodoList', 'test').todos.length
  )
} catch (error) {
  console.error('Push error:', error.message)
  console.error('Stack:', error.stack)
}
