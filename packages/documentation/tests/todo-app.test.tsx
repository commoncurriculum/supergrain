/**
 * TODO App Tests
 *
 * Tests the exact TODO app example from the README.
 * Code is copied exactly from README with only setup and assertions added.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@vitest/browser/context'
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'
import { useState } from 'react'

describe('TODO App Example', () => {
  it('#DOC_TEST_26', async () => {
    // Types
    interface Todo {
      id: number
      text: string
      completed: boolean
    }

    interface AppState {
      todos: Todo[]
      filter: 'all' | 'active' | 'completed'
    }

    // Create store
    const [todoStore, updateTodos] = createStore<AppState>({
      todos: [],
      filter: 'all',
    })

    // Main component
    function TodoApp() {
      const state = useTrackedStore(todoStore)
      const [inputText, setInputText] = useState('')

      const addTodo = () => {
        if (!inputText.trim()) return

        updateTodos({
          $push: {
            todos: {
              id: Date.now(),
              text: inputText,
              completed: false,
            },
          },
        })

        setInputText('')
      }

      const toggleTodo = (id: number) => {
        const index = state.todos.findIndex(t => t.id === id)
        if (index !== -1) {
          updateTodos({
            $set: {
              [`todos.${index}.completed`]: !state.todos[index].completed,
            },
          })
        }
      }

      const deleteTodo = (id: number) => {
        updateTodos({
          $pull: { todos: { id } },
        })
      }

      const clearCompleted = () => {
        const activeTodos = state.todos.filter(t => !t.completed)
        updateTodos({
          $set: { todos: activeTodos },
        })
      }

      // Filter todos
      const filteredTodos = state.todos.filter(todo => {
        if (state.filter === 'active') return !todo.completed
        if (state.filter === 'completed') return todo.completed
        return true
      })

      return (
        <div>
          <h1>TODO App</h1>

          {/* Add todo */}
          <div>
            <input
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && addTodo()}
              placeholder="What needs to be done?"
            />
            <button onClick={addTodo}>Add</button>
          </div>

          {/* Filters */}
          <div>
            {(['all', 'active', 'completed'] as const).map(filterType => (
              <button
                key={filterType}
                className={state.filter === filterType ? 'active' : ''}
                onClick={() => updateTodos({ $set: { filter: filterType } })}
              >
                {filterType}
              </button>
            ))}
          </div>

          {/* Todo list */}
          <ul>
            {filteredTodos.map(todo => (
              <li key={todo.id}>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                />
                <span
                  style={{
                    textDecoration: todo.completed ? 'line-through' : 'none',
                  }}
                >
                  {todo.text}
                </span>
                <button onClick={() => deleteTodo(todo.id)}>Delete</button>
              </li>
            ))}
          </ul>

          {/* Clear completed */}
          {state.todos.some(t => t.completed) && (
            <button onClick={clearCompleted}>Clear Completed</button>
          )}
        </div>
      )
    }

    render(<TodoApp />)

    // Test initial state
    expect(screen.getByText('TODO App')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('What needs to be done?')
    ).toBeInTheDocument()

    // Test filter buttons
    expect(screen.getByText('all')).toHaveClass('active')
    expect(screen.getByText('active')).not.toHaveClass('active')
    expect(screen.getByText('completed')).not.toHaveClass('active')

    // Test adding a todo
    const input = screen.getByPlaceholderText('What needs to be done?')
    await userEvent.type(input, 'First todo')
    await userEvent.click(screen.getByText('Add'))

    // Should see the todo
    expect(screen.getByText('First todo')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()

    // Input should be cleared
    expect(input).toHaveValue('')

    // Add todo with Enter key
    await userEvent.type(input, 'Second todo{Enter}')
    expect(screen.getByText('Second todo')).toBeInTheDocument()

    // Toggle first todo
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[0])

    // First todo should be crossed out
    const firstTodoSpan = screen.getByText('First todo')
    expect(firstTodoSpan).toHaveStyle('text-decoration: line-through')

    // Clear completed button should appear
    expect(screen.getByText('Clear Completed')).toBeInTheDocument()

    // Test filters
    await userEvent.click(screen.getByText('active'))
    expect(screen.getByText('active')).toHaveClass('active')

    // Should only show active todos
    expect(screen.getByText('Second todo')).toBeInTheDocument()
    expect(screen.queryByText('First todo')).not.toBeInTheDocument()

    // Switch to completed filter
    await userEvent.click(screen.getByText('completed'))
    expect(screen.getByText('completed')).toHaveClass('active')

    // Should only show completed todos
    expect(screen.getByText('First todo')).toBeInTheDocument()
    expect(screen.queryByText('Second todo')).not.toBeInTheDocument()

    // Switch back to all
    await userEvent.click(screen.getByText('all'))
    expect(screen.getByText('all')).toHaveClass('active')
    expect(screen.getByText('First todo')).toBeInTheDocument()
    expect(screen.getByText('Second todo')).toBeInTheDocument()

    // Test delete
    const deleteButtons = screen.getAllByText('Delete')
    await userEvent.click(deleteButtons[1]) // Delete second todo
    expect(screen.queryByText('Second todo')).not.toBeInTheDocument()
    expect(screen.getByText('First todo')).toBeInTheDocument()

    // Test clear completed
    await userEvent.click(screen.getByText('Clear Completed'))
    expect(screen.queryByText('First todo')).not.toBeInTheDocument()
    expect(screen.queryByText('Clear Completed')).not.toBeInTheDocument()
  })
})
