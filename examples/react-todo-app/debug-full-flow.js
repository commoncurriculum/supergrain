// Test the full flow including adding todos
import { DocumentStore } from '../../src/core/store/DocumentStore.ts'
import {
  createUserTodoList,
  addTodoToUserList,
  toggleTodoInUserList,
  updateTodoTextInUserList,
  removeTodoFromUserList
} from './src/store.ts'
import { watch } from 'alien-deepsignals'

console.log('Testing full React app flow...')

const store = new DocumentStore()
const DEFAULT_USER_ID = 'user-1'

// === Simulate App.tsx useEffect ===
console.log('\n1. App initialization...')
const existing = store.getDocument('userTodoList', DEFAULT_USER_ID)
if (!existing) {
  const defaultUserList = createUserTodoList(DEFAULT_USER_ID, 'Scott', 'AM')
  store.setDocument('userTodoList', DEFAULT_USER_ID, defaultUserList)
  console.log('   Created default user list')
}

// === Simulate useDocument hook ===
console.log('\n2. Setting up useDocument hook...')
const deepSignal = store.getDeepSignal('userTodoList', DEFAULT_USER_ID)

let renderCount = 0
let latestState = null

const unwatch = watch(deepSignal, (currentValue) => {
  renderCount++
  const value = currentValue._isEmpty ? null : currentValue
  latestState = value

  if (value) {
    console.log(`   Render #${renderCount}: ${value.todos.length} todos`)
    if (renderCount > 1) {
      const lastTodo = value.todos[value.todos.length - 1]
      console.log(`   Latest todo: "${lastTodo.text}"`)
    }
  } else {
    console.log(`   Render #${renderCount}: No user list`)
  }
}, {
  deep: true,
  immediate: true
})

// === Simulate user interactions ===
console.log('\n3. Simulating user interactions...')

// Add a new todo (like typing and clicking Add button)
setTimeout(() => {
  console.log('\n   User adds new todo...')
  addTodoToUserList(DEFAULT_USER_ID, 'Test adding a new task')
}, 100)

// Toggle a todo (like clicking checkbox)
setTimeout(() => {
  console.log('\n   User toggles first todo...')
  if (latestState && latestState.todos.length > 0) {
    toggleTodoInUserList(DEFAULT_USER_ID, latestState.todos[0].id)
  }
}, 200)

// Edit a todo (like double-clicking to edit)
setTimeout(() => {
  console.log('\n   User edits second todo...')
  if (latestState && latestState.todos.length > 1) {
    updateTodoTextInUserList(DEFAULT_USER_ID, latestState.todos[1].id, 'Updated task text')
  }
}, 300)

// Remove a todo (like clicking delete button)
setTimeout(() => {
  console.log('\n   User removes last todo...')
  if (latestState && latestState.todos.length > 0) {
    const lastTodo = latestState.todos[latestState.todos.length - 1]
    removeTodoFromUserList(DEFAULT_USER_ID, lastTodo.id)
  }
}, 400)

// Final state check
setTimeout(() => {
  console.log('\n4. Final state check:')
  console.log(`   Total renders: ${renderCount}`)
  console.log(`   Final todo count: ${latestState?.todos?.length || 0}`)

  if (latestState?.todos) {
    console.log('   Final todos:')
    latestState.todos.forEach((todo, i) => {
      console.log(`     ${i + 1}. [${todo.completed ? '✓' : ' '}] ${todo.text}`)
    })
  }

  console.log('\n✓ React app simulation completed!')
  unwatch()
}, 600)
