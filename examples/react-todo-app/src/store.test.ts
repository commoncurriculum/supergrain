import { describe, test, expect, beforeEach } from 'vitest'
import {
  store,
  createTodo,
  createUserTodoList,
  addTodoToUserList,
  toggleTodoInUserList,
  updateTodoTextInUserList,
  removeTodoFromUserList,
} from './store'

const TEST_USER_ID = 'test-user'

describe('Todo Store Functions', () => {
  beforeEach(() => {
    // Clear the store before each test
    const documentStore = store as any
    if (documentStore.documents) {
      documentStore.documents.clear()
    }
    if (documentStore.signals) {
      documentStore.signals.clear()
    }
    if (documentStore.documentSignals) {
      documentStore.documentSignals.clear()
    }
    if (documentStore.subscriberCounts) {
      documentStore.subscriberCounts.clear()
    }
    if (documentStore.typeListeners) {
      documentStore.typeListeners.clear()
    }
  })

  test('createTodo creates a todo with correct structure', () => {
    const todo = createTodo('Test todo')

    expect(todo).toMatchObject({
      text: 'Test todo',
      completed: false,
    })
    expect(todo.id).toBeDefined()
    expect(todo.createdAt).toBeDefined()
    expect(todo.updatedAt).toBeDefined()
    expect(typeof todo.id).toBe('string')
    expect(typeof todo.createdAt).toBe('number')
    expect(typeof todo.updatedAt).toBe('number')
  })

  test('createUserTodoList creates a user todo list with default todos', () => {
    const userTodoList = createUserTodoList(TEST_USER_ID, 'Test', 'User')

    expect(userTodoList).toMatchObject({
      id: TEST_USER_ID,
      userId: TEST_USER_ID,
      firstName: 'Test',
      lastName: 'User',
    })
    expect(userTodoList.todos).toHaveLength(3)
    expect(userTodoList.todos[0].text).toBe('Learn React basics')
    expect(userTodoList.todos[1].text).toBe('Build a todo app')
    expect(userTodoList.todos[2].text).toBe('Deploy to production')
  })

  test('addTodoToUserList adds a new todo to the user list', () => {
    // Setup initial user list
    const userTodoList = createUserTodoList(TEST_USER_ID, 'Test', 'User')
    store.setDocument('userTodoList', TEST_USER_ID, userTodoList)

    // Add a new todo
    addTodoToUserList(TEST_USER_ID, 'New test todo')

    // Get the updated list
    const updatedList = store.getDocument('userTodoList', TEST_USER_ID)

    expect(updatedList.todos).toHaveLength(4)
    expect(updatedList.todos[3].text).toBe('New test todo')
    expect(updatedList.todos[3].completed).toBe(false)
  })

  test('toggleTodoInUserList toggles todo completion status', () => {
    // Setup initial user list
    const userTodoList = createUserTodoList(TEST_USER_ID, 'Test', 'User')
    store.setDocument('userTodoList', TEST_USER_ID, userTodoList)

    const todoId = userTodoList.todos[0].id
    expect(userTodoList.todos[0].completed).toBe(false)

    // Toggle the first todo
    toggleTodoInUserList(TEST_USER_ID, todoId)

    // Check the updated state
    const updatedList = store.getDocument('userTodoList', TEST_USER_ID)

    expect(updatedList.todos[0].completed).toBe(true)

    // Toggle it back
    toggleTodoInUserList(TEST_USER_ID, todoId)

    const againUpdatedList = store.getDocument('userTodoList', TEST_USER_ID)
    expect(againUpdatedList.todos[0].completed).toBe(false)
  })

  test('updateTodoTextInUserList updates todo text', () => {
    // Setup initial user list
    const userTodoList = createUserTodoList(TEST_USER_ID, 'Test', 'User')
    store.setDocument('userTodoList', TEST_USER_ID, userTodoList)

    const todoId = userTodoList.todos[0].id
    const originalText = userTodoList.todos[0].text
    const newText = 'Updated todo text'

    // Update the todo text
    updateTodoTextInUserList(TEST_USER_ID, todoId, newText)

    // Check the updated state
    const updatedList = store.getDocument('userTodoList', TEST_USER_ID)

    expect(updatedList.todos[0].text).toBe(newText)
    expect(updatedList.todos[0].text).not.toBe(originalText)
  })

  test('removeTodoFromUserList removes a todo from the list', () => {
    // Setup initial user list
    const userTodoList = createUserTodoList(TEST_USER_ID, 'Test', 'User')
    store.setDocument('userTodoList', TEST_USER_ID, userTodoList)

    const todoId = userTodoList.todos[0].id
    expect(userTodoList.todos).toHaveLength(3)

    // Remove the first todo
    removeTodoFromUserList(TEST_USER_ID, todoId)

    // Check the updated state
    const updatedList = store.getDocument('userTodoList', TEST_USER_ID)

    expect(updatedList.todos).toHaveLength(2)
    expect(updatedList.todos.find(todo => todo.id === todoId)).toBeUndefined()
  })

  test('store operations update timestamps correctly', async () => {
    // Setup initial user list
    const userTodoList = createUserTodoList(TEST_USER_ID, 'Test', 'User')
    store.setDocument('userTodoList', TEST_USER_ID, userTodoList)

    const initialUpdatedAt = userTodoList.updatedAt

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 5))
    const startTime = Date.now()

    // Add a new todo
    addTodoToUserList(TEST_USER_ID, 'New todo')

    // Check that updatedAt was updated
    const updatedList = store.getDocument('userTodoList', TEST_USER_ID)

    expect(updatedList.updatedAt).toBeGreaterThanOrEqual(startTime)
    expect(updatedList.updatedAt).toBeGreaterThan(initialUpdatedAt)
  })
})
