// Test if there's an import/module issue
import { store, createUserTodoList } from './src/store.ts'
import { deepSignal, watch } from 'alien-deepsignals'

console.log('=== Testing imports and modules ===')

console.log('\n1. Testing imported store:')
console.log('Store type:', typeof store)
console.log('Store constructor:', store.constructor.name)

console.log('\n2. Testing fresh signal creation:')
const freshSignal = deepSignal({ test: 'fresh' })
console.log('Fresh signal:', freshSignal)

try {
  const unwatch1 = watch(freshSignal, () => {}, { deep: true })
  console.log('✓ Fresh signal is watchable')
  unwatch1()
} catch (e) {
  console.log('✗ Fresh signal not watchable:', e.message)
}

console.log('\n3. Testing imported store methods:')
const userId = 'test-user'
const userList = createUserTodoList(userId, 'Test', 'User')
console.log('Created user list:', userList.todos.length, 'todos')

// Set document using imported store
store.setDocument('userTodoList', userId, userList)
console.log('✓ Document set in imported store')

// Get deep signal using imported store
const deepSignal1 = store.getDeepSignal('userTodoList', userId)
console.log('Deep signal from imported store:', typeof deepSignal1)
console.log('Deep signal todos:', deepSignal1.todos?.length)
console.log('Deep signal _isEmpty:', deepSignal1._isEmpty)

// Check if it has the same structure as fresh signal
console.log('\n4. Comparing signal structures:')
console.log('Fresh signal keys:', Object.keys(freshSignal))
console.log('Store signal keys:', Object.keys(deepSignal1))
console.log('Fresh signal descriptors:', Object.keys(Object.getOwnPropertyDescriptors(freshSignal)))
console.log('Store signal descriptors:', Object.keys(Object.getOwnPropertyDescriptors(deepSignal1)))

// Test watching the store signal
console.log('\n5. Testing watch on store signal:')
try {
  const unwatch2 = watch(deepSignal1, (value) => {
    console.log('Store signal changed, type:', typeof value)
  }, { deep: true, immediate: true })
  console.log('✓ Store signal is watchable')
  unwatch2()
} catch (e) {
  console.log('✗ Store signal not watchable:', e.message)
  console.log('Error details:', e.stack)
}
