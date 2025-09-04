import { DocumentStore, update } from '../../../src/core/store/DocumentStore'
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
  // Check if document exists first
  const existingDoc = store.getDocument('userTodoList', userId)
  if (existingDoc) {
    update(store, 'userTodoList', userId, [
      { op: '$push', path: 'todos', value: newTodo },
      { op: '$set', path: 'updatedAt', value: Date.now() },
    ])
  }
}

export function removeTodoFromUserList(userId: string, todoId: string) {
  const existingDoc = store.getDocument('userTodoList', userId)
  if (existingDoc) {
    const todo = existingDoc.todos.find(todo => todo.id === todoId)
    if (todo) {
      update(store, 'userTodoList', userId, [
        { op: '$pull', path: 'todos', value: todo },
        { op: '$set', path: 'updatedAt', value: Date.now() },
      ])
    }
  }
}

export function toggleTodoInUserList(userId: string, todoId: string) {
  const existingDoc = store.getDocument('userTodoList', userId)
  if (existingDoc) {
    const todoIndex = existingDoc.todos.findIndex(todo => todo.id === todoId)
    if (todoIndex !== -1) {
      const todo = existingDoc.todos[todoIndex]
      const now = Date.now()
      update(store, 'userTodoList', userId, [
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
  const existingDoc = store.getDocument('userTodoList', userId)
  if (existingDoc) {
    const todoIndex = existingDoc.todos.findIndex(todo => todo.id === todoId)
    if (todoIndex !== -1) {
      const now = Date.now()
      update(store, 'userTodoList', userId, [
        { op: '$set', path: `todos.${todoIndex}.text`, value: newText },
        { op: '$set', path: `todos.${todoIndex}.updatedAt`, value: now },
        { op: '$set', path: 'updatedAt', value: now },
      ])
    }
  }
}
