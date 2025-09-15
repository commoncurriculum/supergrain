/**
 * Quick Start Tests
 *
 * Tests the exact quick start example from the README to ensure
 * it works as documented. Code is copied exactly from README.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@vitest/browser/context'
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'

describe('Quick Start Example', () => {
  it('should work exactly as shown in README', async () => {
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
        update({
          $push: {
            todos: { id: Date.now(), text, completed: false },
          },
        })
      }

      return (
        <div>
          <h1>Count: {state.count}</h1>
          <button onClick={() => update({ $inc: { count: 1 } })}>
            Increment
          </button>

          <input
            onKeyPress={e => e.key === 'Enter' && addTodo(e.target.value)}
            placeholder="Add todo..."
          />

          {state.todos.map(todo => (
            <div key={todo.id}>{todo.text}</div>
          ))}
        </div>
      )
    }

    render(<TodoApp />)

    // Test initial state
    expect(screen.getByText('Count: 0')).toBeInTheDocument()

    // Test increment button
    const incrementButton = screen.getByText('Increment')
    await userEvent.click(incrementButton)
    expect(screen.getByText('Count: 1')).toBeInTheDocument()

    // Test adding a todo
    const todoInput = screen.getByPlaceholderText('Add todo...')
    await userEvent.type(todoInput, 'Test todo{Enter}')

    // Should see the todo in the list
    expect(screen.getByText('Test todo')).toBeInTheDocument()

    // Clear the input and add another todo
    await userEvent.clear(todoInput)
    await userEvent.type(todoInput, 'Second todo{Enter}')
    expect(screen.getByText('Second todo')).toBeInTheDocument()

    // Should have both todos
    expect(screen.getByText('Test todo')).toBeInTheDocument()
    expect(screen.getByText('Second todo')).toBeInTheDocument()
  })
})
