// Quick test of the store functions
import {
  store,
  createUserTodoList,
  addTodoToUserList,
  removeTodoFromUserList,
  toggleTodoInUserList,
} from './src/store.ts'

console.log('Testing store functions...')

const userId = 'test-user'
const userList = createUserTodoList(userId, 'Test', 'User')

console.log('1. Created user list:', userList)

// Set the document
store.setDocument('userTodoList', userId, userList)

console.log('2. Set document in store')

// Check if document was stored
const storedDoc = store.getDocument('userTodoList', userId)
console.log('3. Stored document:', storedDoc)

// Get the signal via getDocumentSignal (the React hook interface)
const documentSignal = store.getDocumentSignal('userTodoList', userId)
console.log('4. Document signal value:', documentSignal.value)
console.log(
  '5. Document signal value todos length:',
  documentSignal.value?.todos?.length
)

// Also test the deep signal directly
const deepSignal = store.getDeepSignal('userTodoList', userId)
console.log('6. Deep signal object:', deepSignal)

// Test adding a todo
try {
  addTodoToUserList(userId, 'Test new todo')
  console.log('7. Added todo successfully')
  console.log(
    '   Document signal after add:',
    documentSignal.value?.todos?.length,
    'todos'
  )
} catch (error) {
  console.error('6. Error adding todo:', error)
}

// Test toggling a todo
try {
  const firstTodoId = documentSignal.value?.todos?.[0]?.id
  if (firstTodoId) {
    toggleTodoInUserList(userId, firstTodoId)
    console.log('8. Toggled todo successfully')
    console.log(
      '   First todo completed:',
      documentSignal.value?.todos?.[0]?.completed
    )
  }
} catch (error) {
  console.error('8. Error toggling todo:', error)
}
