// Test the exact sequence that happens in the React app
import { DocumentStore } from '../../src/core/store/DocumentStore.ts'
import { createUserTodoList } from './src/store.ts'
import { watch } from 'alien-deepsignals'

console.log('Testing exact React app sequence...')

const store = new DocumentStore()
const DEFAULT_USER_ID = 'user-1'

console.log('\n=== Step 1: App useEffect - check if document exists ===')
const existing = store.getDocument('userTodoList', DEFAULT_USER_ID)
console.log('Existing document:', existing)

console.log('\n=== Step 2: Create document if not exists ===')
if (!existing) {
  const defaultUserList = createUserTodoList(DEFAULT_USER_ID, 'Scott', 'AM')
  console.log('Created user list with', defaultUserList.todos.length, 'todos')
  store.setDocument('userTodoList', DEFAULT_USER_ID, defaultUserList)
  console.log('Set document in store')
}

console.log('\n=== Step 3: useDocument hook - get deep signal ===')
const deepSignal = store.getDeepSignal('userTodoList', DEFAULT_USER_ID)
console.log('Deep signal:', deepSignal)
console.log('Deep signal isEmpty:', deepSignal._isEmpty)
console.log('Deep signal todos length:', deepSignal.todos?.length)

console.log('\n=== Step 4: useDocument hook - setup watch ===')
try {
  let callCount = 0
  const unwatch = watch(deepSignal, (currentValue) => {
    callCount++
    console.log(`Watch call ${callCount}:`)
    console.log('  currentValue type:', typeof currentValue)
    console.log('  currentValue constructor:', currentValue?.constructor?.name)
    console.log('  currentValue keys:', currentValue ? Object.keys(currentValue) : 'no keys')
    console.log('  currentValue._isEmpty:', currentValue?._isEmpty)

    // This is what the React hook does
    const value = currentValue._isEmpty ? null : currentValue
    console.log('  Processed value:', value ? `${value.todos?.length} todos` : 'null')
  }, {
    deep: true,
    immediate: true
  })

  console.log('✓ Successfully set up watch')

  setTimeout(() => {
    unwatch()
    console.log('Unwatch called')
  }, 100)

} catch (error) {
  console.log('✗ Failed to set up watch:', error.message)
  console.log('Error details:', error)
}
