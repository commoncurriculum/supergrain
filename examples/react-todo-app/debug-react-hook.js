// Test the exact React hook scenario
import {
  store,
  createUserTodoList,
  addTodoToUserList,
} from './src/store.ts'
import { watch } from 'alien-deepsignals'

console.log('Testing React hook scenario...')

const userId = 'user-1'

// Simulate what App.tsx does
const existing = store.getDocument('userTodoList', userId)
if (!existing) {
  const defaultUserList = createUserTodoList(userId, 'Scott', 'AM')
  store.setDocument('userTodoList', userId, defaultUserList)
  console.log('1. Created default user list')
}

// Get the deep signal (this is what the React hook does)
const deepSignal = store.getDeepSignal('userTodoList', userId)
console.log('2. Got deep signal, isEmpty:', deepSignal._isEmpty)
console.log('3. Initial todos count:', deepSignal.todos?.length || 'no todos property')

// Simulate the React hook watch
let updateCount = 0
const unwatch = watch(deepSignal, (currentValue) => {
  updateCount++
  console.log(`4.${updateCount}. Hook update triggered!`)

  const value = currentValue._isEmpty ? null : currentValue
  console.log('    Processed value:', value ? `${value.todos.length} todos` : 'null')

  if (value && value.todos && value.todos.length > 0) {
    const lastTodo = value.todos[value.todos.length - 1]
    console.log('    Last todo:', lastTodo.text)
  }
}, {
  deep: true,
  immediate: true
})

// Wait a bit then add a todo (simulate user interaction)
setTimeout(() => {
  console.log('5. Simulating user adding todo...')
  addTodoToUserList(userId, 'New todo from debug')

  setTimeout(() => {
    console.log('6. Final check:')
    console.log('   Deep signal todos:', deepSignal.todos.length)
    console.log('   Update count:', updateCount)

    const finalDoc = store.getDocument('userTodoList', userId)
    console.log('   Store document todos:', finalDoc?.todos.length)

    unwatch()
  }, 200)
}, 100)
