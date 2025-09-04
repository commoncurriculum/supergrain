// Final comprehensive test exactly matching React app behavior
import { store, createUserTodoList, addTodoToUserList } from './src/store.ts'
import { watch } from 'alien-deepsignals'

async function simulateReactApp() {
  console.log('=== Simulating React App Behavior ===\n')

  const DEFAULT_USER_ID = 'user-1'

  // === App.tsx useEffect simulation ===
  console.log('1. App.tsx useEffect...')
  const existing = store.getDocument('userTodoList', DEFAULT_USER_ID)
  console.log(`   existing document: ${existing ? 'found' : 'null'}`)

  if (!existing) {
    console.log('   creating default user list...')
    const defaultUserList = createUserTodoList(DEFAULT_USER_ID, 'Scott', 'AM')
    store.setDocument('userTodoList', DEFAULT_USER_ID, defaultUserList)
    console.log('   ✓ default user list created')
  }

  // === useDocument hook simulation ===
  console.log('\n2. useDocument hook initialization...')

  // Get the deep signal (useMemo equivalent)
  const deepSignal = store.getDeepSignal('userTodoList', DEFAULT_USER_ID)
  console.log(`   deepSignal type: ${typeof deepSignal}`)
  console.log(`   deepSignal._isEmpty: ${deepSignal._isEmpty}`)
  console.log(`   deepSignal.todos length: ${deepSignal.todos?.length || 0}`)

  // Initial state (useState equivalent)
  let value = deepSignal._isEmpty ? null : deepSignal
  console.log(`   initial value: ${value ? value.todos.length + ' todos' : 'null'}`)

  // Set up watch (useEffect equivalent)
  let reRenderCount = 0
  try {
    console.log('   setting up watch...')

    const unwatch = watch(deepSignal, (currentValue) => {
      reRenderCount++
      const newValue = currentValue._isEmpty ? null : currentValue
      value = newValue  // This would trigger setState in React

      console.log(`   📱 React re-render #${reRenderCount}: ${newValue ? newValue.todos.length + ' todos' : 'loading'}`)

      if (newValue && reRenderCount > 1) {
        const latestTodo = newValue.todos[newValue.todos.length - 1]
        console.log(`      Latest todo: "${latestTodo.text}"`)
      }
    }, {
      deep: true,
      immediate: true
    })

    console.log('   ✓ watch setup successful')

    // === Simulate user interactions ===
    console.log('\n3. Simulating user interactions...')

    await new Promise(resolve => setTimeout(resolve, 50))
    console.log('   User types "My new task" and clicks Add...')
    addTodoToUserList(DEFAULT_USER_ID, 'My new task')

    await new Promise(resolve => setTimeout(resolve, 50))
    console.log('   User adds another task...')
    addTodoToUserList(DEFAULT_USER_ID, 'Another task')

    await new Promise(resolve => setTimeout(resolve, 100))

    // === Final verification ===
    console.log('\n4. Final verification:')
    console.log(`   React component re-renders: ${reRenderCount}`)
    console.log(`   Current todos count: ${value?.todos?.length || 0}`)
    console.log(`   Expected re-renders: 3 (initial + 2 additions)`)
    console.log(`   Expected todos: 5 (3 default + 2 added)`)

    const success = reRenderCount >= 3 && value?.todos?.length === 5
    console.log(`\n${success ? '🎉 SUCCESS' : '❌ FAILED'}: React app should ${success ? 'work correctly' : 'still have issues'}`)

    if (success) {
      console.log('   ✅ Tasks can be added')
      console.log('   ✅ UI will update in real-time')
      console.log('   ✅ All functionality restored')
    }

    unwatch()

  } catch (error) {
    console.log('   ❌ Watch setup failed:', error.message)
    console.log('   This is the root cause of the React app issues')
  }
}

// Run the simulation
simulateReactApp().catch(console.error)
