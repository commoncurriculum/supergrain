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
  store.updateDocument('userTodoList', userId, userTodoList => ({
    ...userTodoList,
    todos: [...userTodoList.todos, newTodo],
    updatedAt: Date.now(),
  }))
}

export function removeTodoFromUserList(userId: string, todoId: string) {
  store.updateDocument('userTodoList', userId, userTodoList => ({
    ...userTodoList,
    todos: userTodoList.todos.filter(todo => todo.id !== todoId),
    updatedAt: Date.now(),
  }))
}

export function toggleTodoInUserList(userId: string, todoId: string) {
  store.updateDocument('userTodoList', userId, userTodoList => ({
    ...userTodoList,
    todos: userTodoList.todos.map(todo =>
      todo.id === todoId ? toggleTodo(todo) : todo
    ),
    updatedAt: Date.now(),
  }))
}

export function updateTodoTextInUserList(
  userId: string,
  todoId: string,
  newText: string
) {
  store.updateDocument('userTodoList', userId, userTodoList => ({
    ...userTodoList,
    todos: userTodoList.todos.map(todo =>
      todo.id === todoId ? updateTodoText(todo, newText) : todo
    ),
    updatedAt: Date.now(),
  }))
}

export function toggleTodo(todo: Todo): Todo {
  return {
    ...todo,
    completed: !todo.completed,
    updatedAt: Date.now(),
  }
}

export function updateTodoText(todo: Todo, text: string): Todo {
  return {
    ...todo,
    text,
    updatedAt: Date.now(),
  }
}
