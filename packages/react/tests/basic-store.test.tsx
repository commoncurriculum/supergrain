import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import React, { useState } from 'react'
import { createStore, signal } from '@storable/core'
import { useStore } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Basic Store Tests', () => {
  afterEach(() => {
    cleanup()
  })

  it('should render initial store value', () => {
    const [store] = createStore({ count: 42 })

    function Counter() {
      const state = useStore(store)
      return <div data-testid="count">{state.count}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('42')
  })

  it('should update when store value changes', async () => {
    const [store, update] = createStore({ count: 0 })

    function Counter() {
      const state = useStore(store)
      return <div data-testid="count">{state.count}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    // Update the store value
    await act(async () => {
      update({ $set: { count: 10 } })
      await flushMicrotasks()
    })

    expect(screen.getByTestId('count').textContent).toBe('10')
  })

  it('should track render count', async () => {
    const [store, update] = createStore({ value: 'initial' })
    let renderCount = 0

    function TestComponent() {
      const state = useStore(store)
      renderCount++
      return <div data-testid="value">{state.value}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)
    expect(screen.getByTestId('value').textContent).toBe('initial')

    // Update store should trigger re-render
    await act(async () => {
      update({ $set: { value: 'updated' } })
      await flushMicrotasks()
    })

    expect(renderCount).toBe(2)
    expect(screen.getByTestId('value').textContent).toBe('updated')
  })

  it('should handle multiple store properties', async () => {
    const [store, update] = createStore({
      name: 'John',
      age: 30,
    })

    function Profile() {
      const state = useStore(store)
      return (
        <div>
          <span data-testid="name">{state.name}</span>
          <span data-testid="age">{state.age}</span>
        </div>
      )
    }

    render(<Profile />)
    expect(screen.getByTestId('name').textContent).toBe('John')
    expect(screen.getByTestId('age').textContent).toBe('30')

    await act(async () => {
      update({ $set: { 'user.age': 31 } })
      await flushMicrotasks()
    })

    expect(screen.getByTestId('name').textContent).toBe('John')
    expect(screen.getByTestId('age').textContent).toBe('31')
  })

  it('should work with signals directly', async () => {
    const count = signal(0)

    function Counter() {
      // For now, wrap signal in an object since useStore expects an object
      const wrapper = { count }
      const state = useStore(wrapper)
      return <div data-testid="count">{state.count.value}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    await act(async () => {
      count.value = 5
      await flushMicrotasks()
    })

    expect(screen.getByTestId('count').textContent).toBe('5')
  })

  it('should handle component unmount without errors', async () => {
    const [store, update] = createStore({ value: 'test' })

    function TestComponent() {
      const state = useStore(store)
      return <div data-testid="value">{state.value}</div>
    }

    const { unmount } = render(<TestComponent />)
    expect(screen.getByTestId('value').textContent).toBe('test')

    // Unmount should not cause errors
    unmount()

    // Store updates after unmount should not cause errors
    update({ $set: { value: 'updated' } })

    // Component is unmounted, so element should not exist
    expect(screen.queryByTestId('value')).toBeNull()
  })

  it('should work with conditional rendering', async () => {
    const [store, update] = createStore({ show: true, message: 'Hello' })

    function ConditionalComponent() {
      const state = useStore(store)
      return (
        <div>
          {state.show && <div data-testid="message">{state.message}</div>}
        </div>
      )
    }

    render(<ConditionalComponent />)
    expect(screen.getByTestId('message').textContent).toBe('Hello')

    await act(async () => {
      update({ $set: { show: false } })
      await flushMicrotasks()
    })

    expect(screen.queryByTestId('message')).toBeNull()

    await act(async () => {
      update({ $set: { show: true, message: 'World' } })
      await flushMicrotasks()
    })

    expect(screen.getByTestId('message').textContent).toBe('World')
  })

  it('should handle rapid updates', async () => {
    const [store, update] = createStore({ counter: 0 })

    function Counter() {
      const state = useStore(store)
      return <div data-testid="counter">{state.counter}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('counter').textContent).toBe('0')

    // Perform multiple rapid updates
    await act(async () => {
      update({ $set: { counter: 1 } })
      update({ $set: { counter: 2 } })
      update({ $set: { counter: 3 } })
      update({ $set: { counter: 4 } })
      update({ $set: { counter: 5 } })
      await flushMicrotasks()
    })

    // Should show the final value
    expect(screen.getByTestId('counter').textContent).toBe('5')
  })

  it('should work with component state', async () => {
    const [store, update] = createStore({ multiplier: 2 })

    function Calculator() {
      const [base, setBase] = useState(10)
      const state = useStore(store)
      const result = base * state.multiplier

      return (
        <div>
          <div data-testid="result">{result}</div>
          <button onClick={() => setBase(base + 1)}>Increment Base</button>
        </div>
      )
    }

    render(<Calculator />)
    expect(screen.getByTestId('result').textContent).toBe('20')

    // Update local state
    await act(async () => {
      screen.getByText('Increment Base').click()
    })
    expect(screen.getByTestId('result').textContent).toBe('22')

    // Update store
    await act(async () => {
      update({ $set: { multiplier: 3 } })
      await flushMicrotasks()
    })
    expect(screen.getByTestId('result').textContent).toBe('33')
  })
})
