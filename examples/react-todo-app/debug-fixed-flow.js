// Test if our fixes worked for the React app scenario
import {
  store,
  createUserTodoList,
  addTodoToUserList
} from './src/store.ts'
import { watch } from 'alien-deepsignals'

console.log('Testing if React app is fixed...')

const DEFAULT_USER_ID = 'user-1'

// Step 1: Initialize like App.tsx does
const existing = store.getDocument('userTodoList', DEFAULT_USER_ID)
if (!existing) {
  const defaultUserList = createUserTodoList(DEFAULT_USER_ID, 'Scott', 'AM')
  store.setDocument('userTodoList', DEFAULT_USER_ID, defaultUserList)
  console.log('1. ✓ Created default user list')
}

// Step 2: Set up watch like useDocument hook does
const deepSignal = store.getDeepSignal('userTodoList', DEFAULT_USER_ID)
let renderCount = 0

const unwatch = watch(deepSignal, (currentValue) => {
  renderCount++
  const value = currentValue._isEmpty ? null : currentValue

  if (value) {
    console.log(`2.${renderCount}. ✓ React component would re-render: ${value.todos.length} todos`)
    if (renderCount > 1) {
      // Show the newest todo that was added
      const newestTodo = value.todos[value.todos.length - 1]
      console.log(`     Latest: "${newestTodo.text}"`)
    }
  } else {
    console.log(`2.${renderCount}. ✓ React component would show loading`)
  }
}, {
  deep: true,
  immediate: true
})

// Step 3: Simulate user adding a todo
setTimeout(() => {
  console.log('\n3. User types "Test new task" and clicks Add...')
  addTodoToUserList(DEFAULT_USER_ID, 'Test new task')
}, 100)

// Step 4: Add another todo to be sure
setTimeout(() => {
  console.log('\n4. User adds another task...')
  addTodoToUserList(DEFAULT_USER_ID, 'Another test task')
}, 200)

// Final check
setTimeout(() => {
  console.log(`\n5. Final result:`)
  console.log(`   - React hook triggered ${renderCount} re-renders ✓`)
  console.log(`   - Final todo count: ${deepSignal.todos.length}`)
  console.log(`   - Expected: 5 todos (3 default + 2 added)`)

  if (renderCount >= 3 && deepSignal.todos.length === 5) {
    console.log('\n🎉 SUCCESS: React app should now work correctly!')
    console.log('   ✓ Tasks can be added')
    console.log('   ✓ Components will re-render')
    console.log('   ✓ UI will update properly')
  } else {
    console.log('\n❌ Still not working correctly')
  }

  unwatch()
}, 400)
