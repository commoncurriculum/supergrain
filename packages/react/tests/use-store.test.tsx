import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import { useStore, useTrackedStore } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Simple useStore Hook', () => {
  it('should track store access and re-render on changes', async () => {
    const [store, update] = createStore({ count: 0 })
    let renders = 0

    function Counter() {
      useStore() // Must be first!
      renders++
      return <div data-testid="count">{store.count}</div>
    }

    render(<Counter />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('count').textContent).toBe('0')

    await act(async () => {
      update({ $set: { count: 1 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('1')

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
      useStore()
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

  it('should handle nested components with proper isolation', async () => {
    const [store, update] = createStore({ parent: 1, child: 10 })
    let parentRenders = 0
    let childRenders = 0

    function Child() {
      const state = useTrackedStore(store)
      childRenders++
      return <span data-testid="child">{state.child}</span>
    }

    function Parent() {
      const state = useTrackedStore(store)
      parentRenders++
      return (
        <div>
          <span data-testid="parent">{state.parent}</span>
          <Child />
        </div>
      )
    }

    render(<Parent />)
    expect(parentRenders).toBe(1)
    expect(childRenders).toBe(1)

    // Update parent property
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

    expect(parentRenders).toBe(2) // Parent doesn't track child property
    expect(childRenders).toBe(3)
    expect(screen.getByTestId('child').textContent).toBe('20')
  })

  it('should work with multiple stores', async () => {
    const [store1, update1] = createStore({ value: 'a' })
    const [store2, update2] = createStore({ value: 'b' })
    let renders = 0

    function Component() {
      useStore()
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

    await act(async () => {
      update1({ $set: { value: 'A' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('s1').textContent).toBe('A')

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
      useStore()
      renders++
      return (
        <div>{store.show && <div data-testid="msg">{store.message}</div>}</div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('msg').textContent).toBe('Hello')

    await act(async () => {
      update({ $set: { show: false } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.queryByTestId('msg')).toBeNull()

    await act(async () => {
      update({ $set: { show: true, message: 'World' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.getByTestId('msg').textContent).toBe('World')
  })

  it('should clean up properly on unmount', async () => {
    const [store, update] = createStore({ value: 'test' })
    let renders = 0

    function Component() {
      useStore()
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

    expect(renders).toBe(1) // No additional renders after unmount
  })

  it('should handle nested object updates', async () => {
    const [store, update] = createStore({
      user: {
        name: 'Alice',
        age: 30,
      },
    })
    let renders = 0

    function Component() {
      useStore()
      renders++
      return (
        <div>
          <span data-testid="name">{store.user.name}</span>
          <span data-testid="age">{store.user.age}</span>
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)

    await act(async () => {
      update({ $set: { 'user.name': 'Bob' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('name').textContent).toBe('Bob')
  })

  it('should handle array operations', async () => {
    const [store, update] = createStore({
      items: ['a', 'b', 'c'],
    })
    let renders = 0

    function Component() {
      useStore()
      renders++
      return (
        <ul data-testid="list">
          {store.items.map((item: any, i: number) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('list').children.length).toBe(3)

    await act(async () => {
      update({ $push: { items: 'd' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('list').children.length).toBe(4)
  })
})

describe('useTrackedStore Hook', () => {
  it('should work with store passed as parameter', async () => {
    const [store, update] = createStore({ value: 100 })
    let renders = 0

    function Component() {
      const state = useTrackedStore(store)
      renders++
      return <div data-testid="value">{state.value}</div>
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('value').textContent).toBe('100')

    await act(async () => {
      update({ $set: { value: 200 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('value').textContent).toBe('200')
  })

  it('should allow different stores in different components', async () => {
    const [store1, update1] = createStore({ name: 'Store 1' })
    const [store2, update2] = createStore({ name: 'Store 2' })
    let renders1 = 0
    let renders2 = 0

    function Component1() {
      const state = useTrackedStore(store1)
      renders1++
      return <div data-testid="c1">{state.name}</div>
    }

    function Component2() {
      const state = useTrackedStore(store2)
      renders2++
      return <div data-testid="c2">{state.name}</div>
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

    // Update store1 - only Component1 should re-render
    await act(async () => {
      update1({ $set: { name: 'Updated 1' } })
      await flushMicrotasks()
    })

    expect(renders1).toBe(2)
    expect(renders2).toBe(1)
    expect(screen.getByTestId('c1').textContent).toBe('Updated 1')

    // Update store2 - only Component2 should re-render
    await act(async () => {
      update2({ $set: { name: 'Updated 2' } })
      await flushMicrotasks()
    })

    expect(renders1).toBe(2)
    expect(renders2).toBe(2)
    expect(screen.getByTestId('c2').textContent).toBe('Updated 2')
  })

  it('should work with computed values', async () => {
    const [store, update] = createStore({ count: 2 })
    let renders = 0

    function Component() {
      const state = useTrackedStore(store)
      renders++
      const doubled = state.count * 2
      const tripled = state.count * 3
      return (
        <div>
          <span data-testid="computed-count">{state.count}</span>
          <span data-testid="doubled">{doubled}</span>
          <span data-testid="tripled">{tripled}</span>
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(screen.getByTestId('doubled').textContent).toBe('4')
    expect(screen.getByTestId('tripled').textContent).toBe('6')

    await act(async () => {
      update({ $set: { count: 5 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('computed-count').textContent).toBe('5')
    expect(screen.getByTestId('doubled').textContent).toBe('10')
    expect(screen.getByTestId('tripled').textContent).toBe('15')
  })

  it('should handle rapid updates correctly', async () => {
    const [store, update] = createStore({ counter: 0 })
    let renders = 0

    function Counter() {
      const state = useTrackedStore(store)
      renders++
      return <div data-testid="counter">{state.counter}</div>
    }

    render(<Counter />)
    expect(renders).toBe(1)

    // Perform multiple rapid updates
    await act(async () => {
      update({ $set: { counter: 1 } })
      update({ $set: { counter: 2 } })
      update({ $set: { counter: 3 } })
      update({ $set: { counter: 4 } })
      update({ $set: { counter: 5 } })
      await flushMicrotasks()
    })

    // Should batch updates and show final value
    expect(screen.getByTestId('counter').textContent).toBe('5')
    // Exact render count depends on batching, but should be > 1
    expect(renders).toBeGreaterThan(1)
  })
})
