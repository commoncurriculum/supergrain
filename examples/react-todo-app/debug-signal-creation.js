// Debug the exact signal creation process
import { DocumentStore } from '../../src/core/store/DocumentStore.ts'
import { createUserTodoList } from './src/store.ts'
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Debugging signal creation process...')

const store = new DocumentStore()
const userId = 'user-1'

console.log('\n=== Step by step signal creation ===')

// Step 1: Get signal before document exists
console.log('1. Getting signal before document exists...')
const signal1 = store.getDeepSignal('userTodoList', userId)
console.log('   Signal1:', signal1)
console.log('   Signal1._isEmpty:', signal1._isEmpty)
console.log('   Signal1 proto:', Object.getPrototypeOf(signal1).constructor.name)

// Test if empty signal is watchable
try {
  const unwatch1 = watch(signal1, () => {}, { deep: true })
  console.log('   ✓ Empty signal is watchable')
  unwatch1()
} catch (e) {
  console.log('   ✗ Empty signal not watchable:', e.message)
}

// Step 2: Create and set document
console.log('\n2. Creating and setting document...')
const userList = createUserTodoList(userId, 'Test', 'User')
console.log('   Created userList with', userList.todos.length, 'todos')

store.setDocument('userTodoList', userId, userList)
console.log('   ✓ Document set in store')

// Step 3: Get signal after document exists
console.log('\n3. Getting signal after document exists...')
const signal2 = store.getDeepSignal('userTodoList', userId)
console.log('   Signal2:', signal2)
console.log('   Signal2._isEmpty:', signal2._isEmpty)
console.log('   Signal2 === signal1:', signal2 === signal1)
console.log('   Signal2 proto:', Object.getPrototypeOf(signal2).constructor.name)

// Test if populated signal is watchable
try {
  const unwatch2 = watch(signal2, () => {}, { deep: true })
  console.log('   ✓ Populated signal is watchable')
  unwatch2()
} catch (e) {
  console.log('   ✗ Populated signal not watchable:', e.message)
}

// Step 4: Compare with fresh signal
console.log('\n4. Comparing with fresh alien-deepsignals...')
const freshSignal = deepSignal({
  id: 'fresh',
  todos: [{ id: '1', text: 'fresh', completed: false }]
})
console.log('   Fresh signal proto:', Object.getPrototypeOf(freshSignal).constructor.name)

try {
  const unwatchFresh = watch(freshSignal, () => {}, { deep: true })
  console.log('   ✓ Fresh signal is watchable')
  unwatchFresh()
} catch (e) {
  console.log('   ✗ Fresh signal not watchable:', e.message)
}

// Step 5: Check internal structure
console.log('\n5. Checking internal structure...')
console.log('   Signal2 keys:', Object.keys(signal2))
console.log('   Signal2 descriptors:', Object.keys(Object.getOwnPropertyDescriptors(signal2)))
console.log('   Fresh keys:', Object.keys(freshSignal))
console.log('   Fresh descriptors:', Object.keys(Object.getOwnPropertyDescriptors(freshSignal)))

// Check if they have the same hidden properties
const signal2Symbols = Object.getOwnPropertySymbols(signal2)
const freshSymbols = Object.getOwnPropertySymbols(freshSignal)
console.log('   Signal2 symbols:', signal2Symbols.length)
console.log('   Fresh symbols:', freshSymbols.length)
