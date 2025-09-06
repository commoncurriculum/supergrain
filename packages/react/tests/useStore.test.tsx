import { describe, it, expect, beforeEach, vi } from 'vitest'
import React, { act } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useStore } from '@storable/react'

describe('useStore', () => {
  beforeEach(() => {
    // Clear any previous renders
    document.body.innerHTML = ''
  })

  it('should initialize with initial state', () => {
    function TestComponent() {
      const [state] = useStore({ count: 0, name: 'test' })
      return (
        <div>
          <span data-testid="count">{state.count}</span>
          <span data-testid="name">{state.name}</span>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.getByTestId('name').textContent).toBe('test')
  })

  it('should update state with $set operator', async () => {
    function TestComponent() {
      const [state, update] = useStore({ count: 0 })
      return (
        <div>
          <span data-testid="count">{state.count}</span>
          <button
            data-testid="button"
            onClick={() => update({ $set: { count: 5 } })}
          >
            Set to 5
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    await act(async () => {
      fireEvent.click(screen.getByTestId('button'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('5')
    })
  })

  it('should update state with $inc operator', async () => {
    function TestComponent() {
      const [state, update] = useStore({ count: 0 })
      return (
        <div>
          <span data-testid="count">{state.count}</span>
          <button
            data-testid="increment"
            onClick={() => update({ $inc: { count: 1 } })}
          >
            Increment
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1')
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('2')
    })
  })

  it('should handle nested object updates', async () => {
    function TestComponent() {
      const [state, update] = useStore({
        user: {
          name: 'Alice',
          age: 30,
          address: {
            city: 'New York',
            zip: '10001',
          },
        },
      })

      return (
        <div>
          <span data-testid="name">{state.user.name}</span>
          <span data-testid="city">{state.user.address.city}</span>
          <button
            data-testid="update-name"
            onClick={() => update({ $set: { 'user.name': 'Bob' } })}
          >
            Change Name
          </button>
          <button
            data-testid="update-city"
            onClick={() =>
              update({ $set: { 'user.address.city': 'Los Angeles' } })
            }
          >
            Change City
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('name').textContent).toBe('Alice')
    expect(screen.getByTestId('city').textContent).toBe('New York')

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-name'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('name').textContent).toBe('Bob')
      expect(screen.getByTestId('city').textContent).toBe('New York')
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-city'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('name').textContent).toBe('Bob')
      expect(screen.getByTestId('city').textContent).toBe('Los Angeles')
    })
  })

  it('should handle array operations with $push', async () => {
    function TestComponent() {
      const [state, update] = useStore({ items: ['a', 'b'] })
      return (
        <div>
          <span data-testid="items">{state.items.join(',')}</span>
          <button
            data-testid="push"
            onClick={() => update({ $push: { items: 'c' } })}
          >
            Push
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('items').textContent).toBe('a,b')

    await act(async () => {
      fireEvent.click(screen.getByTestId('push'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('items').textContent).toBe('a,b,c')
    })
  })

  it('should batch multiple updates', async () => {
    let renderCount = 0

    function TestComponent() {
      const [state, update] = useStore({ a: 0, b: 0, c: 0 })
      renderCount++

      return (
        <div>
          <span data-testid="render-count">{renderCount}</span>
          <span data-testid="sum">{state.a + state.b + state.c}</span>
          <button
            data-testid="batch-update"
            onClick={() => {
              update({ $set: { a: 1 } })
              update({ $set: { b: 2 } })
              update({ $set: { c: 3 } })
            }}
          >
            Batch Update
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('sum').textContent).toBe('0')
    const initialRenderCount = parseInt(
      screen.getByTestId('render-count').textContent!
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('batch-update'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('sum').textContent).toBe('6')
    })

    // Should only re-render once for all three updates
    const finalRenderCount = parseInt(
      screen.getByTestId('render-count').textContent!
    )
    expect(finalRenderCount).toBe(initialRenderCount + 1)
  })

  it('should maintain separate state for multiple instances', async () => {
    function Counter({ id }: { id: string }) {
      const [state, update] = useStore({ count: 0 })
      return (
        <div>
          <span data-testid={`count-${id}`}>{state.count}</span>
          <button
            data-testid={`button-${id}`}
            onClick={() => update({ $inc: { count: 1 } })}
          >
            Increment {id}
          </button>
        </div>
      )
    }

    function App() {
      return (
        <>
          <Counter id="a" />
          <Counter id="b" />
        </>
      )
    }

    render(<App />)
    expect(screen.getByTestId('count-a').textContent).toBe('0')
    expect(screen.getByTestId('count-b').textContent).toBe('0')

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-a'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('count-a').textContent).toBe('1')
      expect(screen.getByTestId('count-b').textContent).toBe('0')
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-b'))
      fireEvent.click(screen.getByTestId('button-b'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('count-a').textContent).toBe('1')
      expect(screen.getByTestId('count-b').textContent).toBe('2')
    })
  })

  it('should only re-render when accessed properties change', async () => {
    let nameRenderCount = 0
    let ageRenderCount = 0

    function NameDisplay() {
      const [state] = useStore({ name: 'Alice', age: 30 })
      nameRenderCount++
      return <span data-testid="name">{state.name}</span>
    }

    function AgeDisplay() {
      const [state] = useStore({ name: 'Alice', age: 30 })
      ageRenderCount++
      return <span data-testid="age">{state.age}</span>
    }

    function Controls() {
      const [, update] = useStore({ name: 'Alice', age: 30 })
      return (
        <>
          <button
            data-testid="update-name"
            onClick={() => update({ $set: { name: 'Bob' } })}
          >
            Update Name
          </button>
          <button
            data-testid="update-age"
            onClick={() => update({ $inc: { age: 1 } })}
          >
            Update Age
          </button>
        </>
      )
    }

    function App() {
      return (
        <>
          <NameDisplay />
          <AgeDisplay />
          <Controls />
        </>
      )
    }

    render(<App />)
    const initialNameRenders = nameRenderCount
    const initialAgeRenders = ageRenderCount

    // Update name - only NameDisplay should re-render
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-name'))
    })

    await waitFor(() => {
      expect(nameRenderCount).toBe(initialNameRenders + 1)
      expect(ageRenderCount).toBe(initialAgeRenders)
    })

    // Update age - only AgeDisplay should re-render
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-age'))
    })

    await waitFor(() => {
      expect(nameRenderCount).toBe(initialNameRenders + 1)
      expect(ageRenderCount).toBe(initialAgeRenders + 1)
    })
  })

  it('should handle complex state transformations', async () => {
    interface Todo {
      id: number
      text: string
      completed: boolean
    }

    function TodoApp() {
      const [state, update] = useStore<{ todos: Todo[]; filter: string }>({
        todos: [
          { id: 1, text: 'Learn React', completed: false },
          { id: 2, text: 'Learn Storable', completed: false },
        ],
        filter: 'all',
      })

      const toggleTodo = (id: number) => {
        const index = state.todos.findIndex(t => t.id === id)
        update({
          $set: {
            [`todos.${index}.completed`]: !state.todos[index].completed,
          },
        })
      }

      const addTodo = (text: string) => {
        update({
          $push: {
            todos: {
              id: Date.now(),
              text,
              completed: false,
            },
          },
        })
      }

      return (
        <div>
          <ul data-testid="todo-list">
            {state.todos.map(todo => (
              <li key={todo.id} data-testid={`todo-${todo.id}`}>
                <span
                  style={{
                    textDecoration: todo.completed ? 'line-through' : 'none',
                  }}
                  onClick={() => toggleTodo(todo.id)}
                >
                  {todo.text}
                </span>
              </li>
            ))}
          </ul>
          <button data-testid="add-todo" onClick={() => addTodo('New Todo')}>
            Add Todo
          </button>
        </div>
      )
    }

    render(<TodoApp />)

    // Initial state
    expect(screen.getByTestId('todo-1').textContent).toBe('Learn React')
    expect(screen.getByTestId('todo-2').textContent).toBe('Learn Storable')

    // Toggle first todo
    await act(async () => {
      fireEvent.click(screen.getByTestId('todo-1').querySelector('span')!)
    })

    await waitFor(() => {
      const todo1 = screen.getByTestId('todo-1').querySelector('span')!
      expect(todo1.style.textDecoration).toBe('line-through')
    })

    // Add new todo
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-todo'))
    })

    await waitFor(() => {
      const todos = screen.getByTestId('todo-list').querySelectorAll('li')
      expect(todos.length).toBe(3)
      expect(todos[2].textContent).toBe('New Todo')
    })
  })
})
