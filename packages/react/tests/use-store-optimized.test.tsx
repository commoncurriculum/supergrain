import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import {
  useFastStore,
  useFastTrackedStore,
  useMinimalStore,
} from '../src/use-store-optimized'
import { flushMicrotasks } from './test-utils'

describe('Optimized useFastStore Hook', () => {
  it('should track store access and re-render on changes', async () => {
    const [store, update] = createStore({ count: 0 })
    let renders = 0

    function Counter() {
      useFastStore() // Must be first!
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
      useFastStore()
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
      useFastStore()
      childRenders++
      return <span data-testid="child">{store.child}</span>
    }

    function Parent() {
      useFastStore()
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

    // Update parent property
    await act(async () => {
      update({ $set: { parent: 2 } })
      await flushMicrotasks()
    })

    expect(parentRenders).toBe(2)
    expect(childRenders).toBe(1) // Child should NOT re-render (doesn't access parent)

    // Update child property
    await act(async () => {
      update({ $set: { child: 20 } })
      await flushMicrotasks()
    })

    expect(parentRenders).toBe(2) // Parent doesn't track child property
    expect(childRenders).toBe(2)
    expect(screen.getByTestId('child').textContent).toBe('20')
  })

  it('should work with multiple stores', async () => {
    const [store1, update1] = createStore({ value: 'a' })
    const [store2, update2] = createStore({ value: 'b' })
    let renders = 0

    function Component() {
      useFastStore()
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

  it('should clean up properly on unmount', async () => {
    const [store, update] = createStore({ value: 'test' })
    let renders = 0

    function Component() {
      useFastStore()
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
})

describe('Optimized useFastTrackedStore Hook', () => {
  it('should work with store passed as parameter', async () => {
    const [store, update] = createStore({ value: 100 })
    let renders = 0

    function Component() {
      const state = useFastTrackedStore(store)
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
      const state = useFastTrackedStore(store1)
      renders1++
      return <div data-testid="c1">{state.name}</div>
    }

    function Component2() {
      const state = useFastTrackedStore(store2)
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

  it('should only track accessed properties', async () => {
    const [store, update] = createStore({ a: 1, b: 2, c: 3 })
    let renders = 0

    function Component() {
      const state = useFastTrackedStore(store)
      renders++
      // Only access a, not b or c
      return <div data-testid="a">{state.a}</div>
    }

    render(<Component />)
    expect(renders).toBe(1)

    // Update b (not accessed) - should NOT re-render
    await act(async () => {
      update({ $set: { b: 20 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1) // No re-render

    // Update c (not accessed) - should NOT re-render
    await act(async () => {
      update({ $set: { c: 30 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1) // No re-render

    // Update a (accessed) - should re-render
    await act(async () => {
      update({ $set: { a: 10 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('a').textContent).toBe('10')
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
      const state = useFastTrackedStore(store)
      renders++
      return (
        <div>
          <span data-testid="name">{state.user.name}</span>
          <span data-testid="age">{state.user.age}</span>
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

  it('should handle rapid updates correctly', async () => {
    const [store, update] = createStore({ counter: 0 })
    let renders = 0

    function Counter() {
      const state = useFastTrackedStore(store)
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
    // Should have minimal renders due to batching
    expect(renders).toBeGreaterThan(1)
  })
})

describe('Optimized useMinimalStore Hook', () => {
  it('should work with direct store access', async () => {
    const [store, update] = createStore({ count: 42 })
    let renders = 0

    function Component() {
      const state = useMinimalStore(store)
      renders++
      return <div data-testid="count">{state.count}</div>
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('count').textContent).toBe('42')

    await act(async () => {
      update({ $set: { count: 84 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('84')
  })

  it('should handle fine-grained updates', async () => {
    const [store, update] = createStore({ x: 1, y: 2 })
    let renders = 0

    function Component() {
      const state = useMinimalStore(store)
      renders++
      // Only access x
      return <div data-testid="x">{state.x}</div>
    }

    render(<Component />)
    expect(renders).toBe(1)

    // Update y (not accessed) - should NOT re-render
    await act(async () => {
      update({ $set: { y: 20 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1) // No re-render

    // Update x (accessed) - should re-render
    await act(async () => {
      update({ $set: { x: 10 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('x').textContent).toBe('10')
  })

  it('should work with computed values', async () => {
    const [store, update] = createStore({ count: 3 })
    let renders = 0

    function Component() {
      const state = useMinimalStore(store)
      renders++
      const doubled = state.count * 2
      const squared = state.count * state.count
      return (
        <div>
          <span data-testid="count">{state.count}</span>
          <span data-testid="doubled">{doubled}</span>
          <span data-testid="squared">{squared}</span>
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('count').textContent).toBe('3')
    expect(screen.getByTestId('doubled').textContent).toBe('6')
    expect(screen.getByTestId('squared').textContent).toBe('9')

    await act(async () => {
      update({ $set: { count: 4 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('4')
    expect(screen.getByTestId('doubled').textContent).toBe('8')
    expect(screen.getByTestId('squared').textContent).toBe('16')
  })

  it('should handle conditional rendering', async () => {
    const [store, update] = createStore({ show: true, message: 'Hello' })
    let renders = 0

    function Component() {
      const state = useMinimalStore(store)
      renders++
      return (
        <div>{state.show && <div data-testid="msg">{state.message}</div>}</div>
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
    const [store, update] = createStore({ value: 'initial' })
    let renders = 0

    function Component() {
      const state = useMinimalStore(store)
      renders++
      return <div data-testid="value">{state.value}</div>
    }

    const { unmount } = render(<Component />)
    expect(renders).toBe(1)

    unmount()

    // Update after unmount - should not cause errors
    await act(async () => {
      update({ $set: { value: 'after-unmount' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1) // No additional renders after unmount
  })
})

describe('Optimized Hooks Comparison', () => {
  it('should all behave identically for basic usage', async () => {
    const [store1, update1] = createStore({ value: 1 })
    const [store2, update2] = createStore({ value: 1 })
    const [store3, update3] = createStore({ value: 1 })

    let renders1 = 0,
      renders2 = 0,
      renders3 = 0

    function FastStoreComponent() {
      useFastStore()
      renders1++
      return <div data-testid="fast">{store1.value}</div>
    }

    function TrackedStoreComponent() {
      const state = useFastTrackedStore(store2)
      renders2++
      return <div data-testid="tracked">{state.value}</div>
    }

    function MinimalStoreComponent() {
      const state = useMinimalStore(store3)
      renders3++
      return <div data-testid="minimal">{state.value}</div>
    }

    function App() {
      return (
        <>
          <FastStoreComponent />
          <TrackedStoreComponent />
          <MinimalStoreComponent />
        </>
      )
    }

    render(<App />)
    expect(renders1).toBe(1)
    expect(renders2).toBe(1)
    expect(renders3).toBe(1)

    // Update all stores
    await act(async () => {
      update1({ $set: { value: 2 } })
      update2({ $set: { value: 2 } })
      update3({ $set: { value: 2 } })
      await flushMicrotasks()
    })

    expect(renders1).toBe(2)
    expect(renders2).toBe(2)
    expect(renders3).toBe(2)

    expect(screen.getByTestId('fast').textContent).toBe('2')
    expect(screen.getByTestId('tracked').textContent).toBe('2')
    expect(screen.getByTestId('minimal').textContent).toBe('2')
  })

  it('should all properly isolate components accessing different properties', async () => {
    const [store, update] = createStore({ a: 1, b: 2 })
    let renders1 = 0,
      renders2 = 0,
      renders3 = 0

    function FastStoreA() {
      useFastStore()
      renders1++
      return <div data-testid="fast-a">{store.a}</div>
    }

    function TrackedStoreB() {
      const state = useFastTrackedStore(store)
      renders2++
      return <div data-testid="tracked-b">{state.b}</div>
    }

    function MinimalStoreA() {
      const state = useMinimalStore(store)
      renders3++
      return <div data-testid="minimal-a">{state.a}</div>
    }

    function App() {
      return (
        <>
          <FastStoreA />
          <TrackedStoreB />
          <MinimalStoreA />
        </>
      )
    }

    render(<App />)
    expect(renders1).toBe(1)
    expect(renders2).toBe(1)
    expect(renders3).toBe(1)

    // Update b - only TrackedStoreB should re-render
    await act(async () => {
      update({ $set: { b: 20 } })
      await flushMicrotasks()
    })

    expect(renders1).toBe(1) // Doesn't track b
    expect(renders2).toBe(2) // Tracks b
    expect(renders3).toBe(1) // Doesn't track b

    // Update a - FastStoreA and MinimalStoreA should re-render
    await act(async () => {
      update({ $set: { a: 10 } })
      await flushMicrotasks()
    })

    expect(renders1).toBe(2) // Tracks a
    expect(renders2).toBe(2) // Doesn't track a
    expect(renders3).toBe(2) // Tracks a
  })
})
