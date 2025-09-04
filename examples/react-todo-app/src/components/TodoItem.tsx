import { useState, FormEvent } from 'react'
import {
  toggleTodoInUserList,
  updateTodoTextInUserList,
  removeTodoFromUserList,
} from '../store'
import type { Todo } from '../types'

interface TodoItemProps {
  todo: Todo
  userId: string
}

export function TodoItem({ todo, userId }: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(todo.text)

  const handleToggle = () => {
    toggleTodoInUserList(userId, todo.id)
  }

  const handleDelete = () => {
    removeTodoFromUserList(userId, todo.id)
  }

  const handleEditStart = () => {
    setIsEditing(true)
    setEditText(todo.text)
  }

  const handleEditCancel = () => {
    setIsEditing(false)
    setEditText(todo.text)
  }

  const handleEditSubmit = (e: FormEvent) => {
    e.preventDefault()

    const trimmedText = editText.trim()
    if (!trimmedText) {
      handleEditCancel()
      return
    }

    if (trimmedText !== todo.text) {
      updateTodoTextInUserList(userId, todo.id, trimmedText)
    }

    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleEditCancel()
    }
  }

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
        todo.completed
          ? 'bg-gray-50 border-gray-200'
          : 'bg-white border-gray-200 hover:border-gray-300'
      }`}
    >
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={handleToggle}
        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 focus:ring-2"
      />

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <form onSubmit={handleEditSubmit}>
            <input
              type="text"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="w-full px-3 py-1 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
              onBlur={handleEditSubmit}
              onKeyDown={handleKeyDown}
            />
          </form>
        ) : (
          <span
            className={`block cursor-pointer select-none ${
              todo.completed ? 'text-gray-500 line-through' : 'text-gray-900'
            }`}
            onDoubleClick={handleEditStart}
            title="Double-click to edit"
          >
            {todo.text}
          </span>
        )}
      </div>

      {!isEditing && (
        <div className="flex gap-1">
          <button
            onClick={handleEditStart}
            className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
            title="Edit"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
            title="Delete"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
