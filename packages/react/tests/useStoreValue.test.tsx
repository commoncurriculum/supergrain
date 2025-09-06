import { describe, it, expect, beforeEach } from 'vitest'
import React, { act } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createStore, useStoreValue } from '@storable/react'

describe.skip('useStoreValue', () => {
  beforeEach(() => {
    // Clear any previous renders
    document.body.innerHTML = ''
  })

  it('should subscribe to global store state', () => {
    const [globalState] = createStore({ count: 0, name: 'test' })

    function TestComponent() {
      const state = useStoreValue(globalState)
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

  it('should update when global store changes', async () => {
    const [globalState, globalUpdate] = createStore({ count: 0 })

    function TestComponent() {
      const state = useStoreValue(globalState)
      return <span data-testid="count">{state.count}</span>
    }

    function Controls() {
      return (
        <button
          data-testid="increment"
          onClick={() => globalUpdate({ $inc: { count: 1 } })}
        >
          Increment
        </button>
      )
    }

    render(
      <>
        <TestComponent />
        <Controls />
      </>
    )

    expect(screen.getByTestId('count').textContent).toBe('0')

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1')
    })
  })

  it('should work with selector function', async () => {
    const [globalState, globalUpdate] = createStore({
      user: { name: 'Alice', age: 30 },
      theme: 'light',
    })

    function UserGreeting() {
      const greeting = useStoreValue(
        globalState,
        state => `Hello, ${state.user.name}!`
      )
      return <span data-testid="greeting">{greeting}</span>
    }

    function Controls() {
      return (
        <button
          data-testid="change-name"
          onClick={() => globalUpdate({ $set: { 'user.name': 'Bob' } })}
        >
          Change Name
        </button>
      )
    }

    render(
      <>
        <UserGreeting />
        <Controls />
      </>
    )

    expect(screen.getByTestId('greeting').textContent).toBe('Hello, Alice!')

    await act(async () => {
      fireEvent.click(screen.getByTestId('change-name'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('greeting').textContent).toBe('Hello, Bob!')
    })
  })

  it('should only re-render components that access changed properties', async () => {
    const [globalState, globalUpdate] = createStore({
      user: { name: 'Alice', age: 30 },
      theme: 'light',
      counter: 0,
    })

    let userRenderCount = 0
    let themeRenderCount = 0
    let counterRenderCount = 0

    function UserDisplay() {
      const state = useStoreValue(globalState)
      userRenderCount++
      return (
        <span data-testid="user">
          {state.user.name} ({userRenderCount})
        </span>
      )
    }

    function ThemeDisplay() {
      const state = useStoreValue(globalState)
      themeRenderCount++
      return (
        <span data-testid="theme">
          {state.theme} ({themeRenderCount})
        </span>
      )
    }

    function CounterDisplay() {
      const state = useStoreValue(globalState)
      counterRenderCount++
      return (
        <span data-testid="counter">
          {state.counter} ({counterRenderCount})
        </span>
      )
    }

    function Controls() {
      return (
        <>
          <button
            data-testid="update-user"
            onClick={() => globalUpdate({ $set: { 'user.name': 'Bob' } })}
          >
            Update User
          </button>
          <button
            data-testid="update-theme"
            onClick={() => globalUpdate({ $set: { theme: 'dark' } })}
          >
            Update Theme
          </button>
          <button
            data-testid="update-counter"
            onClick={() => globalUpdate({ $inc: { counter: 1 } })}
          >
            Update Counter
          </button>
        </>
      )
    }

    render(
      <>
        <UserDisplay />
        <ThemeDisplay />
        <CounterDisplay />
        <Controls />
      </>
    )

    const initialUserRenders = userRenderCount
    const initialThemeRenders = themeRenderCount
    const initialCounterRenders = counterRenderCount

    // Update user - only UserDisplay should re-render
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-user'))
    })

    await waitFor(() => {
      expect(userRenderCount).toBe(initialUserRenders + 1)
      expect(themeRenderCount).toBe(initialThemeRenders)
      expect(counterRenderCount).toBe(initialCounterRenders)
    })

    // Update theme - only ThemeDisplay should re-render
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-theme'))
    })

    await waitFor(() => {
      expect(userRenderCount).toBe(initialUserRenders + 1)
      expect(themeRenderCount).toBe(initialThemeRenders + 1)
      expect(counterRenderCount).toBe(initialCounterRenders)
    })

    // Update counter - only CounterDisplay should re-render
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-counter'))
    })

    await waitFor(() => {
      expect(userRenderCount).toBe(initialUserRenders + 1)
      expect(themeRenderCount).toBe(initialThemeRenders + 1)
      expect(counterRenderCount).toBe(initialCounterRenders + 1)
    })
  })

  it('should handle multiple components subscribing to same store', async () => {
    const [globalState, globalUpdate] = createStore({ count: 0 })

    function DisplayA() {
      const state = useStoreValue(globalState)
      return <span data-testid="display-a">A: {state.count}</span>
    }

    function DisplayB() {
      const state = useStoreValue(globalState)
      return <span data-testid="display-b">B: {state.count}</span>
    }

    function Controls() {
      return (
        <button
          data-testid="increment"
          onClick={() => globalUpdate({ $inc: { count: 1 } })}
        >
          Increment
        </button>
      )
    }

    render(
      <>
        <DisplayA />
        <DisplayB />
        <Controls />
      </>
    )

    expect(screen.getByTestId('display-a').textContent).toBe('A: 0')
    expect(screen.getByTestId('display-b').textContent).toBe('B: 0')

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('display-a').textContent).toBe('A: 1')
      expect(screen.getByTestId('display-b').textContent).toBe('B: 1')
    })
  })

  it('should handle nested object access efficiently', async () => {
    const [globalState, globalUpdate] = createStore({
      deeply: {
        nested: {
          object: {
            value: 'initial',
            count: 0,
          },
        },
      },
      otherData: 'unchanged',
    })

    let deepValueRenderCount = 0
    let otherDataRenderCount = 0

    function DeepValueDisplay() {
      const state = useStoreValue(globalState)
      deepValueRenderCount++
      return (
        <span data-testid="deep-value">{state.deeply.nested.object.value}</span>
      )
    }

    function OtherDataDisplay() {
      const state = useStoreValue(globalState)
      otherDataRenderCount++
      return <span data-testid="other-data">{state.otherData}</span>
    }

    function Controls() {
      return (
        <button
          data-testid="update-deep"
          onClick={() =>
            globalUpdate({
              $set: { 'deeply.nested.object.value': 'updated' },
            })
          }
        >
          Update Deep Value
        </button>
      )
    }

    render(
      <>
        <DeepValueDisplay />
        <OtherDataDisplay />
        <Controls />
      </>
    )

    const initialDeepRenders = deepValueRenderCount
    const initialOtherRenders = otherDataRenderCount

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-deep'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('deep-value').textContent).toBe('updated')
      expect(deepValueRenderCount).toBe(initialDeepRenders + 1)
      expect(otherDataRenderCount).toBe(initialOtherRenders)
    })
  })

  it('should handle array transformations with selector', async () => {
    const [globalState, globalUpdate] = createStore({
      todos: [
        { id: 1, text: 'Task 1', completed: false },
        { id: 2, text: 'Task 2', completed: true },
        { id: 3, text: 'Task 3', completed: false },
      ],
    })

    function CompletedCount() {
      const completedCount = useStoreValue(
        globalState,
        state => state.todos.filter(t => t.completed).length
      )
      return <span data-testid="completed">{completedCount}</span>
    }

    function Controls() {
      return (
        <button
          data-testid="toggle-first"
          onClick={() =>
            globalUpdate({
              $set: { 'todos.0.completed': true },
            })
          }
        >
          Complete First
        </button>
      )
    }

    render(
      <>
        <CompletedCount />
        <Controls />
      </>
    )

    expect(screen.getByTestId('completed').textContent).toBe('1')

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-first'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('completed').textContent).toBe('2')
    })
  })

  it('should handle rapid updates correctly', async () => {
    const [globalState, globalUpdate] = createStore({ counter: 0 })

    function Counter() {
      const state = useStoreValue(globalState)
      return <span data-testid="counter">{state.counter}</span>
    }

    function Controls() {
      return (
        <button
          data-testid="rapid-increment"
          onClick={() => {
            // Fire multiple updates rapidly
            for (let i = 0; i < 10; i++) {
              globalUpdate({ $inc: { counter: 1 } })
            }
          }}
        >
          Rapid Increment
        </button>
      )
    }

    render(
      <>
        <Counter />
        <Controls />
      </>
    )

    expect(screen.getByTestId('counter').textContent).toBe('0')

    await act(async () => {
      fireEvent.click(screen.getByTestId('rapid-increment'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('counter').textContent).toBe('10')
    })
  })
})
