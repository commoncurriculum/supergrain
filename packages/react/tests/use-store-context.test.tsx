import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from '@storable/core'
import { useStore, useTrackedStore } from '../src/use-store-context'

// Helper to flush microtasks
const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Context-based useStore Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should handle basic reactivity', async () => {
    const [store, update] = createStore({ count: 0 })
    let renders = 0

    function Counter() {
      useStore()
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
  })

  it('should only re-render when accessed properties change', async () => {
    const [store, update] = createStore({ count: 0, name: 'Alice' })
    let renders = 0

    function Component() {
      useStore()
      renders++
      return <div data-testid="count">{store.count}</div>
    }

    render(<Component />)
    expect(renders).toBe(1)

    // Update unused property - should not re-render
    await act(async () => {
      update({ $set: { name: 'Bob' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1)

    // Update used property - should re-render
    await act(async () => {
      update({ $set: { count: 1 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
  })

  it('should handle nested components with proper isolation', async () => {
    const [store, update] = createStore({ parent: 1, child: 10 })
    let parentRenders = 0
    let childRenders = 0

    function Child() {
      useStore()
      childRenders++
      return <span data-testid="child">{store.child}</span>
    }

    function Parent() {
      useStore()
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

  it('should handle deeply nested components', async () => {
    const [store, update] = createStore({
      grandparent: 1,
      parent: 10,
      child: 100,
    })

    let grandparentRenders = 0
    let parentRenders = 0
    let childRenders = 0

    function Child() {
      useStore()
      childRenders++
      return <span data-testid="child">{store.child}</span>
    }

    function Parent() {
      useStore()
      parentRenders++
      return (
        <div>
          <span data-testid="parent">{store.parent}</span>
          <Child />
        </div>
      )
    }

    function GrandParent() {
      useStore()
      grandparentRenders++
      return (
        <div>
          <span data-testid="grandparent">{store.grandparent}</span>
          <Parent />
        </div>
      )
    }

    render(<GrandParent />)
    expect(grandparentRenders).toBe(1)
    expect(parentRenders).toBe(1)
    expect(childRenders).toBe(1)

    // Update child property - only child should re-render
    await act(async () => {
      update({ $set: { child: 200 } })
      await flushMicrotasks()
    })

    expect(grandparentRenders).toBe(1)
    expect(parentRenders).toBe(1)
    expect(childRenders).toBe(2)
    expect(screen.getByTestId('child').textContent).toBe('200')

    // Update parent property - parent and child should re-render
    await act(async () => {
      update({ $set: { parent: 20 } })
      await flushMicrotasks()
    })

    expect(grandparentRenders).toBe(1)
    expect(parentRenders).toBe(2)
    expect(childRenders).toBe(3) // Re-renders due to parent re-render
    expect(screen.getByTestId('parent').textContent).toBe('20')

    // Update grandparent property - all should re-render
    await act(async () => {
      update({ $set: { grandparent: 2 } })
      await flushMicrotasks()
    })

    expect(grandparentRenders).toBe(2)
    expect(parentRenders).toBe(3)
    expect(childRenders).toBe(4)
    expect(screen.getByTestId('grandparent').textContent).toBe('2')
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
          <span data-testid="store1">{store1.value}</span>
          <span data-testid="store2">{store2.value}</span>
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
    expect(screen.getByTestId('store1').textContent).toBe('A')

    await act(async () => {
      update2({ $set: { value: 'B' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.getByTestId('store2').textContent).toBe('B')
  })

  it('should handle conditional rendering', async () => {
    const [store, update] = createStore({ show: false, value: 'test' })
    let renders = 0

    function Component() {
      useStore()
      renders++
      return (
        <div>
          {store.show && <span data-testid="value">{store.value}</span>}
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.queryByTestId('value')).toBeNull()

    await act(async () => {
      update({ $set: { show: true } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('value').textContent).toBe('test')

    // Now component tracks both show and value
    await act(async () => {
      update({ $set: { value: 'updated' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.getByTestId('value').textContent).toBe('updated')
  })

  it('should handle sibling components independently', async () => {
    const [store, update] = createStore({ a: 1, b: 2 })
    let aRenders = 0
    let bRenders = 0

    function ComponentA() {
      useStore()
      aRenders++
      return <span data-testid="a">{store.a}</span>
    }

    function ComponentB() {
      useStore()
      bRenders++
      return <span data-testid="b">{store.b}</span>
    }

    function Parent() {
      return (
        <div>
          <ComponentA />
          <ComponentB />
        </div>
      )
    }

    render(<Parent />)
    expect(aRenders).toBe(1)
    expect(bRenders).toBe(1)

    // Update property A - only ComponentA should re-render
    await act(async () => {
      update({ $set: { a: 10 } })
      await flushMicrotasks()
    })

    expect(aRenders).toBe(2)
    expect(bRenders).toBe(1)
    expect(screen.getByTestId('a').textContent).toBe('10')

    // Update property B - only ComponentB should re-render
    await act(async () => {
      update({ $set: { b: 20 } })
      await flushMicrotasks()
    })

    expect(aRenders).toBe(2)
    expect(bRenders).toBe(2)
    expect(screen.getByTestId('b').textContent).toBe('20')
  })

  it('should clean up properly on unmount', async () => {
    const [store, update] = createStore({ value: 'initial' })
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
})

describe('useTrackedStore Hook', () => {
  it('should handle basic reactivity', async () => {
    const [store, update] = createStore({ count: 0 })
    let renders = 0

    function Counter() {
      const state = useTrackedStore(store)
      renders++
      return <div data-testid="count">{state.count}</div>
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

  it('should return the same proxy instance across renders', () => {
    const [store] = createStore({ value: 1 })
    let proxy1: any = null
    let proxy2: any = null

    function Component() {
      const state = useTrackedStore(store)
      if (!proxy1) {
        proxy1 = state
      } else if (!proxy2) {
        proxy2 = state
      }
      return <div>{state.value}</div>
    }

    const { rerender } = render(<Component />)
    rerender(<Component />)

    expect(proxy1).toBe(proxy2)
  })
})
