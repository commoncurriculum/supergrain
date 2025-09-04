import { DocumentStore, update } from '@commoncurriculum/storable'
import type { Todo, UserTodoList } from './types'

// Create a global store instance
export const store = new DocumentStore()

// Utility functions for managing todos
export function createTodo(text: string): Todo {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    text,
    completed: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function createUserTodoList(
  userId: string,
  firstName: string,
  lastName: string
): UserTodoList {
  const now = Date.now()

  // Create 3 default todos
  const defaultTodos = [
    createTodo('Learn React basics'),
    createTodo('Build a todo app'),
    createTodo('Deploy to production'),
  ]

  return {
    id: userId,
    userId,
    firstName,
    lastName,
    todos: defaultTodos,
    createdAt: now,
    updatedAt: now,
  }
}

export function addTodoToUserList(userId: string, todoText: string) {
  const newTodo = createTodo(todoText)
  const userListSignal = store.getDeepSignal('userTodoList', userId)
  if (userListSignal.value) {
    update(userListSignal, [
      { op: '$push', path: 'todos', value: newTodo },
      { op: '$set', path: 'updatedAt', value: Date.now() },
    ])
  }
}

export function removeTodoFromUserList(userId: string, todoId: string) {
  const userListSignal = store.getDeepSignal('userTodoList', userId)
  if (userListSignal.value) {
    const todo = userListSignal.value.todos.find(todo => todo.id === todoId)
    if (todo) {
      update(userListSignal, [
        { op: '$pull', path: 'todos', value: todo },
        { op: '$set', path: 'updatedAt', value: Date.now() },
      ])
    }
  }
}

export function toggleTodoInUserList(userId: string, todoId: string) {
  const userListSignal = store.getDeepSignal('userTodoList', userId)
  if (userListSignal.value) {
    const todoIndex = userListSignal.value.todos.findIndex(
      todo => todo.id === todoId
    )
    if (todoIndex !== -1) {
      const todo = userListSignal.value.todos[todoIndex]
      const now = Date.now()
      update(userListSignal, [
        {
          op: '$set',
          path: `todos.${todoIndex}.completed`,
          value: !todo.completed,
        },
        { op: '$set', path: `todos.${todoIndex}.updatedAt`, value: now },
        { op: '$set', path: 'updatedAt', value: now },
      ])
    }
  }
}

export function updateTodoTextInUserList(
  userId: string,
  todoId: string,
  newText: string
) {
  const userListSignal = store.getDeepSignal('userTodoList', userId)
  if (userListSignal.value) {
    const todoIndex = userListSignal.value.todos.findIndex(
      todo => todo.id === todoId
    )
    if (todoIndex !== -1) {
      const now = Date.now()
      update(userListSignal, [
        { op: '$set', path: `todos.${todoIndex}.text`, value: newText },
        { op: '$set', path: `todos.${todoIndex}.updatedAt`, value: now },
        { op: '$set', path: 'updatedAt', value: now },
      ])
    }
  }
}
