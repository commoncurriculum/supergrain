/**
 * Quick Start Tests
 *
 * Tests the basic quick start example from the README to ensure
 * it works as documented.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@vitest/browser/context'
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'

describe('Quick Start Example', () => {
  it('should create a store and update count', async () => {
    // Create a store with initial state
    const [store, update] = createStore({
      count: 0,
      todos: [],
    })

    // Use in React components
    function TodoApp() {
      const state = useTrackedStore(store)

      // Updates MUST use the update function with operators
      const addTodo = (text: string) => {
        if (!text.trim()) return
        update({
          $push: {
            todos: { id: Date.now(), text, completed: false },
          },
        })
      }

      return (
        <div>
          <h1>Count: {state.count}</h1>
          <button
            onClick={() => update({ $inc: { count: 1 } })}
            data-testid="increment"
          >
            Increment
          </button>

          <input
            data-testid="todo-input"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const target = e.target as HTMLInputElement
                addTodo(target.value)
                target.value = ''
              }
            }}
            placeholder="Add todo..."
          />

          <div data-testid="todos">
            {state.todos.map(todo => (
              <div key={todo.id}>{todo.text}</div>
            ))}
          </div>
        </div>
      )
    }

    render(<TodoApp />)

    // Test initial state
    expect(screen.getByText('Count: 0')).toBeInTheDocument()

    // Test increment button
    await userEvent.click(screen.getByTestId('increment'))
    expect(screen.getByText('Count: 1')).toBeInTheDocument()

    // Test adding a todo
    const todoInput = screen.getByTestId('todo-input')
    await userEvent.type(todoInput, 'Test todo')
    await userEvent.keyboard('{Enter}')

    // Should see the todo in the list
    expect(screen.getByText('Test todo')).toBeInTheDocument()

    // Add another todo
    await userEvent.type(todoInput, 'Second todo')
    await userEvent.keyboard('{Enter}')

    expect(screen.getByText('Second todo')).toBeInTheDocument()

    // Should have both todos
    const todosContainer = screen.getByTestId('todos')
    expect(todosContainer.children).toHaveLength(2)
  })

  it('should handle empty todo input', async () => {
    const [store, update] = createStore({
      count: 0,
      todos: [],
    })

    function TodoApp() {
      const state = useTrackedStore(store)

      const addTodo = (text: string) => {
        if (!text.trim()) return
        update({
          $push: {
            todos: { id: Date.now(), text, completed: false },
          },
        })
      }

      return (
        <div>
          <input
            data-testid="todo-input"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const target = e.target as HTMLInputElement
                addTodo(target.value)
                target.value = ''
              }
            }}
            placeholder="Add todo..."
          />
          <div data-testid="todos">
            {state.todos.map(todo => (
              <div key={todo.id}>{todo.text}</div>
            ))}
          </div>
        </div>
      )
    }

    render(<TodoApp />)

    // Try to add empty todo
    const todoInput = screen.getByTestId('todo-input')
    await userEvent.type(todoInput, '   ') // Just spaces
    await userEvent.keyboard('{Enter}')

    // Should not add the todo
    const todosContainer = screen.getByTestId('todos')
    expect(todosContainer.children).toHaveLength(0)
  })
})
