import { DocumentStore } from '@commoncurriculum/storable'
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
    userListSignal.$todos.value.push(newTodo)
    userListSignal.$updatedAt.value = Date.now()
  }
}

export function removeTodoFromUserList(userId: string, todoId: string) {
  const userListSignal = store.getDeepSignal('userTodoList', userId)
  if (userListSignal.value) {
    const todoIndex = userListSignal.$todos.value.findIndex(
      (todo: any) => todo.id === todoId
    )
    if (todoIndex !== -1) {
      userListSignal.$todos.value.splice(todoIndex, 1)
      userListSignal.$updatedAt.value = Date.now()
    }
  }
}

export function toggleTodoInUserList(userId: string, todoId: string) {
  const userListSignal = store.getDeepSignal('userTodoList', userId)
  if (userListSignal.value) {
    const todo = userListSignal.$todos.value.find(
      (todo: any) => todo.id === todoId
    )
    if (todo) {
      todo.completed = !todo.completed
      todo.updatedAt = Date.now()
      userListSignal.$updatedAt.value = Date.now()
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
    const todo = userListSignal.$todos.value.find(
      (todo: any) => todo.id === todoId
    )
    if (todo) {
      todo.text = newText
      todo.updatedAt = Date.now()
      userListSignal.$updatedAt.value = Date.now()
    }
  }
}
