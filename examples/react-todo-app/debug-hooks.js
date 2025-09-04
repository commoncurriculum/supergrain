import { store, addTodoToUserList, createUserTodoList } from './src/store.js'
import { watch } from 'alien-deepsignals'

// Create test user
const userId = 'test-user'
const userList = createUserTodoList(userId, 'Test', 'User')
store.setDocument('userTodoList', userId, userList)

// Get the signal and watch it
const signal = store.getDeepSignal('userTodoList', userId)

console.log('Initial todos:', signal.todos.length)

// Watch for changes
const unwatch = watch(signal, (value) => {
  console.log('Signal changed! New todos count:', value.todos?.length || 0)
  console.log('Latest todo:', value.todos?.[value.todos.length - 1]?.text || 'none')
}, {
  deep: true,
  immediate: true
})

// Add a todo
console.log('Adding todo...')
addTodoToUserList(userId, 'Test todo from debug')

// Check the final state
setTimeout(() => {
  const finalSignal = store.getDeepSignal('userTodoList', userId)
  console.log('Final todos count:', finalSignal.todos.length)
  console.log('Final todos:', finalSignal.todos.map(t => t.text))
  unwatch()
}, 100)
