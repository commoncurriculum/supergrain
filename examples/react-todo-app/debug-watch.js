// Test if watch is working with deep signals
import {
  store,
  createUserTodoList,
  addTodoToUserList,
} from './src/store.ts'
import { watch } from 'alien-deepsignals'

console.log('Testing watch functionality...')

const userId = 'test-user'
const userList = createUserTodoList(userId, 'Test', 'User')

console.log('1. Created user list with', userList.todos.length, 'todos')

// Set the document
store.setDocument('userTodoList', userId, userList)
console.log('2. Set document in store')

// Get the deep signal
const deepSignal = store.getDeepSignal('userTodoList', userId)
console.log('3. Got deep signal, todos count:', deepSignal.todos.length)

// Set up watch
let watchCallCount = 0
const unwatch = watch(deepSignal, (value) => {
  watchCallCount++
  console.log(`4.${watchCallCount}. Watch triggered! Todos count:`, value.todos?.length || 0)
  if (value.todos?.length > 0) {
    const lastTodo = value.todos[value.todos.length - 1]
    console.log(`     Latest todo: "${lastTodo.text}"`)
  }
}, {
  deep: true,
  immediate: true
})

// Add a todo after a brief delay
setTimeout(() => {
  console.log('5. Adding new todo...')
  addTodoToUserList(userId, 'New test todo')

  setTimeout(() => {
    console.log('6. Final state check')
    console.log('   Deep signal todos count:', deepSignal.todos.length)
    console.log('   Watch call count:', watchCallCount)
    unwatch()
  }, 100)
}, 100)
