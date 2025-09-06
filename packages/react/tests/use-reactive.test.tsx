import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import { useReactive } from '../src/use-reactive'
import { flushMicrotasks } from './test-utils'

describe('useReactive Hook', () => {
  it('should enable automatic tracking when called first', async () => {
    const [store, update] = createStore({ count: 0 })
    let renders = 0

    function Counter() {
      useReactive() // MUST be first!
      renders++

      // Now store access should be tracked
      return <div data-testid="count">{store.count}</div>
    }

    render(<Counter />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('count').textContent).toBe('0')

    // Update store - component should re-render
    await act(async () => {
      update({ $set: { count: 1 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('1')

    // Update again
    await act(async () => {
      update({ $set: { count: 2 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.getByTestId('count').textContent).toBe('2')
  })

  it('should only track accessed properties', async () => {
    const [store, update] = createStore({ x: 1, y: 2, z: 3 })
    let renders = 0

    function Component() {
      useReactive()
      renders++

      // Only access x and y, not z
      return (
        <div>
          <span data-testid="x">{store.x}</span>
          <span data-testid="y">{store.y}</span>
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)

    // Update z (not accessed) - should NOT re-render
    await act(async () => {
      update({ $set: { z: 10 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1) // No re-render

    // Update x (accessed) - should re-render
    await act(async () => {
      update({ $set: { x: 5 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('x').textContent).toBe('5')
  })

  it('should work with multiple stores', async () => {
    const [store1, update1] = createStore({ value: 'a' })
    const [store2, update2] = createStore({ value: 'b' })
    let renders = 0

    function Component() {
      useReactive()
      renders++

      return (
        <div>
          <span data-testid="s1">{store1.value}</span>
          <span data-testid="s2">{store2.value}</span>
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('s1').textContent).toBe('a')
    expect(screen.getByTestId('s2').textContent).toBe('b')

    // Update store1
    await act(async () => {
      update1({ $set: { value: 'A' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('s1').textContent).toBe('A')

    // Update store2
    await act(async () => {
      update2({ $set: { value: 'B' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.getByTestId('s2').textContent).toBe('B')
  })

  it('should handle conditional rendering', async () => {
    const [store, update] = createStore({ show: true, message: 'Hello' })
    let renders = 0

    function Component() {
      useReactive()
      renders++

      return (
        <div>{store.show && <div data-testid="msg">{store.message}</div>}</div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('msg').textContent).toBe('Hello')

    // Hide message
    await act(async () => {
      update({ $set: { show: false } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.queryByTestId('msg')).toBeNull()

    // Show again with new message
    await act(async () => {
      update({ $set: { show: true, message: 'World' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.getByTestId('msg').textContent).toBe('World')
  })

  it('should handle nested components', async () => {
    const [store, update] = createStore({ parent: 1, child: 10 })
    let parentRenders = 0
    let childRenders = 0

    function Child() {
      useReactive()
      childRenders++
      return <span data-testid="child">{store.child}</span>
    }

    function Parent() {
      useReactive()
      parentRenders++

      return (
        <div>
          <span data-testid="parent">{store.parent}</span>
          <Child />
        </div>
      )
    }

    render(<Parent />)
    expect(parentRenders).toBe(1)
    expect(childRenders).toBe(1)

    // Update parent property - only parent should re-render
    await act(async () => {
      update({ $set: { parent: 2 } })
      await flushMicrotasks()
    })

    expect(parentRenders).toBe(2)
    expect(childRenders).toBe(2) // Child re-renders because parent re-renders

    // Update child property - only child should re-render
    await act(async () => {
      update({ $set: { child: 20 } })
      await flushMicrotasks()
    })

    expect(parentRenders).toBe(2) // Parent doesn't access child property
    expect(childRenders).toBe(3)
  })

  it('should clean up when component unmounts', async () => {
    const [store, update] = createStore({ value: 'test' })
    let renders = 0

    function Component() {
      useReactive()
      renders++
      return <div data-testid="value">{store.value}</div>
    }

    const { unmount } = render(<Component />)
    expect(renders).toBe(1)

    unmount()

    // Update after unmount - should not cause errors
    await act(async () => {
      update({ $set: { value: 'updated' } })
      await flushMicrotasks()
    })

    // Should still be 1 since component is unmounted
    expect(renders).toBe(1)
  })

  it('should handle errors gracefully', () => {
    const [store] = createStore({ value: 'test' })

    function BrokenComponent() {
      useReactive()

      if (store.value === 'error') {
        throw new Error('Test error')
      }

      return <div>{store.value}</div>
    }

    // Should not throw during initial render
    expect(() => render(<BrokenComponent />)).not.toThrow()
  })

  it('should work with React.memo', async () => {
    const [store, update] = createStore({ count: 0, unrelated: 'x' })
    let renders = 0

    const MemoizedComponent = React.memo(function Component() {
      useReactive()
      renders++
      return <div data-testid="count">{store.count}</div>
    })

    render(<MemoizedComponent />)
    expect(renders).toBe(1)

    // Update tracked property
    await act(async () => {
      update({ $set: { count: 1 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('1')
  })
})
