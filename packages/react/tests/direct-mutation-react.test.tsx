import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { createStore } from '@supergrain/core'
import { useTrackedStore } from '../src/use-store'

describe('Direct Mutation with React Integration', () => {
  it('should work with click handlers and direct mutations', () => {
    const [store] = createStore({ count: 0, message: 'Hello' })

    function App() {
      const { count, message } = useTrackedStore(store)

      return (
        <div>
          <div data-testid="count">{count}</div>
          <div data-testid="message">{message}</div>
          <button
            data-testid="increment"
            onClick={() => {
              store.count = store.count + 1
            }}
          >
            Increment
          </button>
          <button
            data-testid="change-message"
            onClick={() => {
              store.message = 'Updated!'
            }}
          >
            Change Message
          </button>
        </div>
      )
    }

    render(<App />)

    // Initial state
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.getByTestId('message').textContent).toBe('Hello')

    // Click increment button (uses direct mutation)
    fireEvent.click(screen.getByTestId('increment'))
    expect(screen.getByTestId('count')).toHaveTextContent('1')

    fireEvent.click(screen.getByTestId('increment'))
    expect(screen.getByTestId('count')).toHaveTextContent('2')

    // Click message button (uses direct mutation)
    fireEvent.click(screen.getByTestId('change-message'))
    expect(screen.getByTestId('message')).toHaveTextContent('Updated!')
  })

  it('should work with both direct mutations and updateStore calls', () => {
    const [store, updateStore] = createStore({
      directValue: 0,
      operatorValue: 0,
      nested: { directProp: 'direct', operatorProp: 'operator' },
    })

    function App() {
      const state = useTrackedStore(store)

      return (
        <div>
          <div data-testid="direct-value">{state.directValue}</div>
          <div data-testid="operator-value">{state.operatorValue}</div>
          <div data-testid="direct-prop">{state.nested.directProp}</div>
          <div data-testid="operator-prop">{state.nested.operatorProp}</div>
          <button
            data-testid="direct-button"
            onClick={() => {
              store.directValue = store.directValue + 1
              store.nested.directProp = `direct-${store.directValue}`
            }}
          >
            Direct Mutation
          </button>
          <button
            data-testid="operator-button"
            onClick={() =>
              updateStore({
                $set: {
                  operatorValue: store.operatorValue + 1,
                  'nested.operatorProp': `operator-${store.operatorValue + 1}`,
                },
              })
            }
          >
            Operator Update
          </button>
        </div>
      )
    }

    render(<App />)

    // Initial state
    expect(screen.getByTestId('direct-value')).toHaveTextContent('0')
    expect(screen.getByTestId('operator-value')).toHaveTextContent('0')
    expect(screen.getByTestId('direct-prop')).toHaveTextContent('direct')
    expect(screen.getByTestId('operator-prop')).toHaveTextContent('operator')

    // Use direct mutations
    fireEvent.click(screen.getByTestId('direct-button'))
    expect(screen.getByTestId('direct-value')).toHaveTextContent('1')
    expect(screen.getByTestId('direct-prop')).toHaveTextContent('direct-1')

    // Use operator updates
    fireEvent.click(screen.getByTestId('operator-button'))
    expect(screen.getByTestId('operator-value')).toHaveTextContent('1')
    expect(screen.getByTestId('operator-prop')).toHaveTextContent('operator-1')

    // Mix both approaches
    fireEvent.click(screen.getByTestId('direct-button'))
    fireEvent.click(screen.getByTestId('operator-button'))

    expect(screen.getByTestId('direct-value')).toHaveTextContent('2')
    expect(screen.getByTestId('operator-value')).toHaveTextContent('2')
    expect(screen.getByTestId('direct-prop')).toHaveTextContent('direct-2')
    expect(screen.getByTestId('operator-prop')).toHaveTextContent('operator-2')
  })

  it('should handle array mutations with React rendering', () => {
    const [store] = createStore({
      items: [
        { id: 1, name: 'Item 1', completed: false },
        { id: 2, name: 'Item 2', completed: false },
      ],
    })

    function TodoList() {
      const { items } = useTrackedStore(store)

      return (
        <div>
          {items.map((item, index) => (
            <div key={item.id}>
              <span data-testid={`item-${index}-name`}>{item.name}</span>
              <span data-testid={`item-${index}-completed`}>
                {item.completed ? 'Done' : 'Pending'}
              </span>
              <button
                data-testid={`toggle-${index}`}
                onClick={() => {
                  store.items[index].completed = !store.items[index].completed
                }}
              >
                Toggle
              </button>
              <button
                data-testid={`rename-${index}`}
                onClick={() => {
                  store.items[index].name = `Updated ${item.name}`
                }}
              >
                Rename
              </button>
            </div>
          ))}
        </div>
      )
    }

    render(<TodoList />)

    // Initial state
    expect(screen.getByTestId('item-0-name')).toHaveTextContent('Item 1')
    expect(screen.getByTestId('item-0-completed')).toHaveTextContent('Pending')
    expect(screen.getByTestId('item-1-name')).toHaveTextContent('Item 2')
    expect(screen.getByTestId('item-1-completed')).toHaveTextContent('Pending')

    // Toggle completion via direct mutation
    fireEvent.click(screen.getByTestId('toggle-0'))
    expect(screen.getByTestId('item-0-completed')).toHaveTextContent('Done')

    // Rename via direct mutation
    fireEvent.click(screen.getByTestId('rename-1'))
    expect(screen.getByTestId('item-1-name')).toHaveTextContent(
      'Updated Item 2'
    )

    // Toggle again
    fireEvent.click(screen.getByTestId('toggle-0'))
    expect(screen.getByTestId('item-0-completed')).toHaveTextContent('Pending')
  })

  it('should demonstrate direct mutation API improvements', () => {
    const [store, updateStore] = createStore({
      counter: 0,
      user: { name: 'John', age: 25 },
      todos: [{ id: 1, text: 'Learn Storable', done: false }],
    })

    function App() {
      const state = useTrackedStore(store)

      return (
        <div>
          <div data-testid="counter">{state.counter}</div>
          <div data-testid="user-info">
            {state.user.name} ({state.user.age})
          </div>
          <div data-testid="todo-text">{state.todos[0].text}</div>
          <div data-testid="todo-status">
            {state.todos[0].done ? 'Done' : 'Pending'}
          </div>

          <button
            data-testid="direct-updates"
            onClick={() => {
              // Show how clean direct mutations are
              store.counter++
              store.user.name = 'Jane'
              store.user.age = 30
              store.todos[0].text = 'Master Storable'
              store.todos[0].done = true
            }}
          >
            Direct Updates (Clean API)
          </button>

          <button
            data-testid="operator-updates"
            onClick={() => {
              // Reset using traditional approach for comparison
              updateStore({
                $set: {
                  counter: 0,
                  'user.name': 'John',
                  'user.age': 25,
                  'todos.0.text': 'Learn Storable',
                  'todos.0.done': false,
                },
              })
            }}
          >
            Operator Updates (Verbose API)
          </button>
        </div>
      )
    }

    render(<App />)

    // Initial state
    expect(screen.getByTestId('counter')).toHaveTextContent('0')
    expect(screen.getByTestId('user-info')).toHaveTextContent('John (25)')
    expect(screen.getByTestId('todo-text')).toHaveTextContent('Learn Storable')
    expect(screen.getByTestId('todo-status')).toHaveTextContent('Pending')

    // Test direct mutations (clean API)
    fireEvent.click(screen.getByTestId('direct-updates'))
    expect(screen.getByTestId('counter')).toHaveTextContent('1')
    expect(screen.getByTestId('user-info')).toHaveTextContent('Jane (30)')
    expect(screen.getByTestId('todo-text')).toHaveTextContent('Master Storable')
    expect(screen.getByTestId('todo-status')).toHaveTextContent('Done')

    // Test operator updates (traditional API)
    fireEvent.click(screen.getByTestId('operator-updates'))
    expect(screen.getByTestId('counter')).toHaveTextContent('0')
    expect(screen.getByTestId('user-info')).toHaveTextContent('John (25)')
    expect(screen.getByTestId('todo-text')).toHaveTextContent('Learn Storable')
    expect(screen.getByTestId('todo-status')).toHaveTextContent('Pending')
  })
})
