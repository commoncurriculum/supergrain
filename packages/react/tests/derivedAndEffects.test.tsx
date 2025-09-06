import { describe, it, expect, beforeEach, vi } from 'vitest'
import React, { act } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  useStore,
  useDerived,
  useComputed,
  useStoreEffect,
  createStore,
  useStoreValue,
} from '../src'

describe.skip('useDerived / useComputed', () => {
  beforeEach(() => {
    // Clear any previous renders
    document.body.innerHTML = ''
  })

  it('should compute derived values', () => {
    function TestComponent() {
      const [state] = useStore({ a: 2, b: 3 })
      const sum = useDerived(() => state.a + state.b)
      const product = useComputed(() => state.a * state.b) // alias test

      return (
        <div>
          <span data-testid="sum">{sum}</span>
          <span data-testid="product">{product}</span>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('sum').textContent).toBe('5')
    expect(screen.getByTestId('product').textContent).toBe('6')
  })

  it('should update derived values when dependencies change', async () => {
    function TestComponent() {
      const [state, update] = useStore({ a: 2, b: 3 })
      const sum = useDerived(() => state.a + state.b)

      return (
        <div>
          <span data-testid="sum">{sum}</span>
          <button
            data-testid="update-a"
            onClick={() => update({ $set: { a: 5 } })}
          >
            Update A
          </button>
          <button
            data-testid="update-b"
            onClick={() => update({ $inc: { b: 2 } })}
          >
            Update B
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('sum').textContent).toBe('5')

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-a'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('sum').textContent).toBe('8') // 5 + 3
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-b'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('sum').textContent).toBe('10') // 5 + 5
    })
  })

  it('should handle complex derived computations', async () => {
    interface Todo {
      id: number
      text: string
      completed: boolean
    }

    function TodoApp() {
      const [state, update] = useStore<{
        todos: Todo[]
        filter: 'all' | 'active' | 'completed'
      }>({
        todos: [
          { id: 1, text: 'Task 1', completed: false },
          { id: 2, text: 'Task 2', completed: true },
          { id: 3, text: 'Task 3', completed: false },
        ],
        filter: 'all',
      })

      const filteredTodos = useDerived(() => {
        switch (state.filter) {
          case 'active':
            return state.todos.filter(t => !t.completed)
          case 'completed':
            return state.todos.filter(t => t.completed)
          default:
            return state.todos
        }
      })

      const stats = useDerived(() => ({
        total: state.todos.length,
        completed: state.todos.filter(t => t.completed).length,
        active: state.todos.filter(t => !t.completed).length,
      }))

      return (
        <div>
          <span data-testid="filtered-count">{filteredTodos.length}</span>
          <span data-testid="stats">
            {stats.active}/{stats.completed}/{stats.total}
          </span>
          <button
            data-testid="filter-active"
            onClick={() => update({ $set: { filter: 'active' } })}
          >
            Active
          </button>
          <button
            data-testid="filter-completed"
            onClick={() => update({ $set: { filter: 'completed' } })}
          >
            Completed
          </button>
          <button
            data-testid="toggle-first"
            onClick={() => update({ $set: { 'todos.0.completed': true } })}
          >
            Complete First
          </button>
        </div>
      )
    }

    render(<TodoApp />)
    expect(screen.getByTestId('filtered-count').textContent).toBe('3')
    expect(screen.getByTestId('stats').textContent).toBe('2/1/3')

    await act(async () => {
      fireEvent.click(screen.getByTestId('filter-active'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('filtered-count').textContent).toBe('2')
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('filter-completed'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('filtered-count').textContent).toBe('1')
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-first'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('stats').textContent).toBe('1/2/3')
      expect(screen.getByTestId('filtered-count').textContent).toBe('2')
    })
  })

  it('should memoize derived computations', async () => {
    let computationCount = 0

    function TestComponent() {
      const [state, update] = useStore({ value: 1, unrelated: 'test' })

      const expensive = useDerived(() => {
        computationCount++
        // Simulate expensive computation
        return state.value * 2
      })

      return (
        <div>
          <span data-testid="result">{expensive}</span>
          <span data-testid="computation-count">{computationCount}</span>
          <button
            data-testid="update-unrelated"
            onClick={() => update({ $set: { unrelated: 'changed' } })}
          >
            Update Unrelated
          </button>
          <button
            data-testid="update-value"
            onClick={() => update({ $inc: { value: 1 } })}
          >
            Update Value
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    const initialCount = computationCount

    // Updating unrelated value should not trigger recomputation
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-unrelated'))
    })

    await waitFor(() => {
      expect(computationCount).toBe(initialCount)
    })

    // Updating the dependent value should trigger recomputation
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-value'))
    })

    await waitFor(() => {
      expect(computationCount).toBe(initialCount + 1)
      expect(screen.getByTestId('result').textContent).toBe('4')
    })
  })
})

describe.skip('useStoreEffect', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('should run effect when dependencies change', async () => {
    const effectLog: string[] = []

    function TestComponent() {
      const [state, update] = useStore({ count: 0, name: 'test' })

      useStoreEffect(() => {
        effectLog.push(`Count is ${state.count}`)
      })

      return (
        <div>
          <span data-testid="count">{state.count}</span>
          <button
            data-testid="increment"
            onClick={() => update({ $inc: { count: 1 } })}
          >
            Increment
          </button>
          <button
            data-testid="update-name"
            onClick={() => update({ $set: { name: 'changed' } })}
          >
            Update Name
          </button>
        </div>
      )
    }

    render(<TestComponent />)

    // Effect should run on mount
    expect(effectLog).toContain('Count is 0')
    const initialLength = effectLog.length

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'))
    })

    await waitFor(() => {
      expect(effectLog).toContain('Count is 1')
      expect(effectLog.length).toBe(initialLength + 1)
    })

    // Updating unrelated property should not trigger effect
    const lengthBeforeNameUpdate = effectLog.length
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-name'))
    })

    // Give it a moment to potentially trigger (it shouldn't)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(effectLog.length).toBe(lengthBeforeNameUpdate)
  })

  it('should handle cleanup function', async () => {
    const cleanupLog: string[] = []
    let timerId: NodeJS.Timeout | null = null

    function TestComponent() {
      const [state, update] = useStore({ value: 1 })

      useStoreEffect(() => {
        const id = setTimeout(() => {
          cleanupLog.push(`Timer for value ${state.value}`)
        }, 1000)
        timerId = id

        return () => {
          clearTimeout(id)
          cleanupLog.push(`Cleanup for value ${state.value}`)
        }
      })

      return (
        <div>
          <span data-testid="value">{state.value}</span>
          <button
            data-testid="update"
            onClick={() => update({ $inc: { value: 1 } })}
          >
            Update
          </button>
        </div>
      )
    }

    const { unmount } = render(<TestComponent />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('update'))
    })

    await waitFor(() => {
      expect(cleanupLog).toContain('Cleanup for value 1')
    })

    unmount()

    // Cleanup should be called on unmount
    expect(cleanupLog).toContain('Cleanup for value 2')

    // Timer should be cleared
    if (timerId) {
      clearTimeout(timerId)
    }
  })

  it('should work with global store', async () => {
    const [globalState, globalUpdate] = createStore({
      theme: 'light',
      user: null as { name: string } | null,
    })
    const log: string[] = []

    function ThemeWatcher() {
      const state = useStoreValue(globalState)

      useStoreEffect(() => {
        log.push(`Theme changed to ${state.theme}`)

        // Simulate theme application
        if (typeof document !== 'undefined') {
          document.body.className = `theme-${state.theme}`
        }
      })

      return <span data-testid="theme">{state.theme}</span>
    }

    function Controls() {
      return (
        <button
          data-testid="toggle-theme"
          onClick={() =>
            globalUpdate({
              $set: {
                theme: globalState.theme === 'light' ? 'dark' : 'light',
              },
            })
          }
        >
          Toggle Theme
        </button>
      )
    }

    render(
      <>
        <ThemeWatcher />
        <Controls />
      </>
    )

    expect(log).toContain('Theme changed to light')
    expect(document.body.className).toBe('theme-light')

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-theme'))
    })

    await waitFor(() => {
      expect(log).toContain('Theme changed to dark')
      expect(document.body.className).toBe('theme-dark')
    })
  })

  it('should handle multiple effects independently', async () => {
    const effectALog: number[] = []
    const effectBLog: string[] = []

    function TestComponent() {
      const [state, update] = useStore({ a: 1, b: 'x' })

      useStoreEffect(() => {
        effectALog.push(state.a)
      })

      useStoreEffect(() => {
        effectBLog.push(state.b)
      })

      return (
        <div>
          <button
            data-testid="update-a"
            onClick={() => update({ $inc: { a: 1 } })}
          >
            Update A
          </button>
          <button
            data-testid="update-b"
            onClick={() => update({ $set: { b: state.b + 'x' } })}
          >
            Update B
          </button>
        </div>
      )
    }

    render(<TestComponent />)

    expect(effectALog).toEqual([1])
    expect(effectBLog).toEqual(['x'])

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-a'))
    })

    await waitFor(() => {
      expect(effectALog).toEqual([1, 2])
      expect(effectBLog).toEqual(['x']) // Should not change
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-b'))
    })

    await waitFor(() => {
      expect(effectALog).toEqual([1, 2]) // Should not change
      expect(effectBLog).toEqual(['x', 'xx'])
    })
  })

  it('should handle async operations in effects', async () => {
    const log: string[] = []

    function TestComponent() {
      const [state, update] = useStore({ query: 'initial' })

      useStoreEffect(() => {
        let cancelled = false

        const fetchData = async () => {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 50))
          if (!cancelled) {
            log.push(`Fetched: ${state.query}`)
          }
        }

        fetchData()

        return () => {
          cancelled = true
          log.push(`Cancelled: ${state.query}`)
        }
      })

      return (
        <div>
          <span data-testid="query">{state.query}</span>
          <button
            data-testid="update-query"
            onClick={() => update({ $set: { query: 'updated' } })}
          >
            Update Query
          </button>
        </div>
      )
    }

    render(<TestComponent />)

    // Initial fetch
    await waitFor(() => {
      expect(log).toContain('Fetched: initial')
    })

    // Update query - should cancel previous and start new
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-query'))
    })

    await waitFor(() => {
      expect(log).toContain('Cancelled: initial')
      expect(log).toContain('Fetched: updated')
    })
  })
})
