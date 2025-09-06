import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import { useStore } from '../src/use-store-fixed'
import { flushMicrotasks } from './test-utils'

describe('Fixed useStore', () => {
  it('should re-render when store updates', async () => {
    const [store, update] = createStore({ count: 1 })
    let renders = 0

    function Counter() {
      renders++
      const state = useStore(store)
      return <div data-testid="count">{state.count}</div>
    }

    render(<Counter />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('count').textContent).toBe('1')

    // Update the store
    await act(async () => {
      update({ $set: { count: 2 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('2')

    // Update again
    await act(async () => {
      update({ $set: { count: 3 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.getByTestId('count').textContent).toBe('3')
  })

  it('should only re-render when accessed properties change', async () => {
    const [store, update] = createStore({ x: 1, y: 2, z: 3 })
    let renders = 0

    function Component() {
      renders++
      const state = useStore(store)
      // Only access x and y, not z
      return (
        <div>
          <span data-testid="x">{state.x}</span>
          <span data-testid="y">{state.y}</span>
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('x').textContent).toBe('1')
    expect(screen.getByTestId('y').textContent).toBe('2')

    // Update z (not accessed) - should NOT re-render
    await act(async () => {
      update({ $set: { z: 10 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1) // Still 1, no re-render

    // Update x (accessed) - should re-render
    await act(async () => {
      update({ $set: { x: 5 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('x').textContent).toBe('5')
  })

  it('should handle multiple components using the same store', async () => {
    const [store, update] = createStore({ value: 'hello' })
    let renders1 = 0
    let renders2 = 0

    function Component1() {
      renders1++
      const state = useStore(store)
      return <div data-testid="comp1">{state.value}</div>
    }

    function Component2() {
      renders2++
      const state = useStore(store)
      return <div data-testid="comp2">{state.value.toUpperCase()}</div>
    }

    function App() {
      return (
        <>
          <Component1 />
          <Component2 />
        </>
      )
    }

    render(<App />)
    expect(renders1).toBe(1)
    expect(renders2).toBe(1)
    expect(screen.getByTestId('comp1').textContent).toBe('hello')
    expect(screen.getByTestId('comp2').textContent).toBe('HELLO')

    // Update store - both components should re-render
    await act(async () => {
      update({ $set: { value: 'world' } })
      await flushMicrotasks()
    })

    expect(renders1).toBe(2)
    expect(renders2).toBe(2)
    expect(screen.getByTestId('comp1').textContent).toBe('world')
    expect(screen.getByTestId('comp2').textContent).toBe('WORLD')
  })

  it('should clean up when component unmounts', async () => {
    const [store, update] = createStore({ show: true, value: 'test' })
    let renders = 0

    function TestComponent() {
      renders++
      const state = useStore(store)
      return state.show ? <div data-testid="value">{state.value}</div> : null
    }

    const { unmount } = render(<TestComponent />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('value').textContent).toBe('test')

    // Unmount the component
    unmount()

    // Update store after unmount - should not cause errors
    await act(async () => {
      update({ $set: { value: 'updated' } })
      await flushMicrotasks()
    })

    // Renders should still be 1 (component is unmounted)
    expect(renders).toBe(1)
  })

  it('should handle rapid updates correctly', async () => {
    const [store, update] = createStore({ counter: 0 })
    let renders = 0
    let lastValue = 0

    function Counter() {
      renders++
      const state = useStore(store)
      lastValue = state.counter
      return <div data-testid="counter">{state.counter}</div>
    }

    render(<Counter />)
    expect(renders).toBe(1)
    expect(lastValue).toBe(0)

    // Perform multiple rapid updates
    await act(async () => {
      update({ $set: { counter: 1 } })
      update({ $set: { counter: 2 } })
      update({ $set: { counter: 3 } })
      await flushMicrotasks()
    })

    // Should show the final value
    expect(lastValue).toBe(3)
    expect(screen.getByTestId('counter').textContent).toBe('3')
    // Might re-render once or multiple times depending on batching
    expect(renders).toBeGreaterThan(1)
  })
})
