import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import { useTrackedStore, useReactive } from '../src/use-reactive-v2'
import { flushMicrotasks } from './test-utils'

describe('useTrackedStore Hook', () => {
  it('should track store access and re-render on changes', async () => {
    const [store, update] = createStore({ count: 0 })
    let renders = 0

    function Counter() {
      const trackedStore = useTrackedStore(store)
      renders++
      return <div data-testid="count">{trackedStore.count}</div>
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

  it('should only track accessed properties', async () => {
    const [store, update] = createStore({ x: 1, y: 2, z: 3 })
    let renders = 0

    function Component() {
      const trackedStore = useTrackedStore(store)
      renders++
      // Only access x and y
      return (
        <div>
          <span data-testid="x">{trackedStore.x}</span>
          <span data-testid="y">{trackedStore.y}</span>
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

    expect(renders).toBe(1)

    // Update x (accessed) - should re-render
    await act(async () => {
      update({ $set: { x: 5 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('x').textContent).toBe('5')
  })

  it('should handle nested components with independent tracking', async () => {
    const [store, update] = createStore({ parent: 1, child: 10 })
    let parentRenders = 0
    let childRenders = 0

    function Child() {
      const trackedStore = useTrackedStore(store)
      childRenders++
      return <span data-testid="child">{trackedStore.child}</span>
    }

    function Parent() {
      const trackedStore = useTrackedStore(store)
      parentRenders++
      return (
        <div>
          <span data-testid="parent">{trackedStore.parent}</span>
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
    expect(childRenders).toBe(2) // Re-renders because parent re-renders

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
      const tracked1 = useTrackedStore(store1)
      const tracked2 = useTrackedStore(store2)
      renders++
      return (
        <div>
          <span data-testid="s1">{tracked1.value}</span>
          <span data-testid="s2">{tracked2.value}</span>
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

  it('should prevent direct mutation', () => {
    const [store] = createStore({ value: 'test' })

    function Component() {
      const trackedStore = useTrackedStore(store)

      // Try to mutate directly
      expect(() => {
        trackedStore.value = 'mutated'
      }).toThrow('Direct mutation of store state is not allowed')

      return <div>{trackedStore.value}</div>
    }

    expect(() => render(<Component />)).not.toThrow()
  })
})

describe('useReactive with track function', () => {
  it('should track store access when wrapped with track()', async () => {
    const [store, update] = createStore({ value: 10 })
    let renders = 0

    function Component() {
      const track = useReactive()
      renders++

      // Explicitly track store access
      const value = track(() => store.value)

      return <div data-testid="value">{value}</div>
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('value').textContent).toBe('10')

    await act(async () => {
      update({ $set: { value: 20 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('value').textContent).toBe('20')
  })

  it('should allow selective tracking', async () => {
    const [store, update] = createStore({ tracked: 1, untracked: 2 })
    let renders = 0

    function Component() {
      const track = useReactive()
      renders++

      // Only track one property
      const trackedValue = track(() => store.tracked)
      // Don't track this one
      const untrackedValue = store.untracked

      return (
        <div>
          <span data-testid="tracked">{trackedValue}</span>
          <span data-testid="untracked">{untrackedValue}</span>
        </div>
      )
    }

    render(<Component />)
    expect(renders).toBe(1)

    // Update untracked - should NOT re-render
    await act(async () => {
      update({ $set: { untracked: 20 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(1)
    // DOM doesn't update for untracked
    expect(screen.getByTestId('untracked').textContent).toBe('2')

    // Update tracked - should re-render
    await act(async () => {
      update({ $set: { tracked: 10 } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('tracked').textContent).toBe('10')
    // Now untracked also updates since component re-rendered
    expect(screen.getByTestId('untracked').textContent).toBe('20')
  })

  it('should handle conditional tracking', async () => {
    const [store, update] = createStore({ show: true, message: 'Hello' })
    let renders = 0

    function Component() {
      const track = useReactive()
      renders++

      const show = track(() => store.show)
      // Only track message if show is true
      const message = show ? track(() => store.message) : ''

      return <div>{show && <span data-testid="msg">{message}</span>}</div>
    }

    render(<Component />)
    expect(renders).toBe(1)
    expect(screen.getByTestId('msg').textContent).toBe('Hello')

    // Update message while shown - should re-render
    await act(async () => {
      update({ $set: { message: 'World' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(2)
    expect(screen.getByTestId('msg').textContent).toBe('World')

    // Hide the message
    await act(async () => {
      update({ $set: { show: false } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3)
    expect(screen.queryByTestId('msg')).toBeNull()

    // Update message while hidden - should NOT re-render
    await act(async () => {
      update({ $set: { message: 'Hidden' } })
      await flushMicrotasks()
    })

    expect(renders).toBe(3) // No re-render since message isn't tracked when hidden
  })

  it('should properly isolate nested component tracking', async () => {
    const [store, update] = createStore({ outer: 1, inner: 10 })
    let outerRenders = 0
    let innerRenders = 0

    function Inner() {
      const track = useReactive()
      innerRenders++
      const value = track(() => store.inner)
      return <span data-testid="inner">{value}</span>
    }

    function Outer() {
      const track = useReactive()
      outerRenders++
      const value = track(() => store.outer)
      return (
        <div>
          <span data-testid="outer">{value}</span>
          <Inner />
        </div>
      )
    }

    render(<Outer />)
    expect(outerRenders).toBe(1)
    expect(innerRenders).toBe(1)

    // Update inner - only Inner should re-render (after parent re-render cascade)
    await act(async () => {
      update({ $set: { inner: 20 } })
      await flushMicrotasks()
    })

    // With proper isolation, only Inner tracks 'inner' property
    expect(outerRenders).toBe(1) // Outer doesn't re-render
    expect(innerRenders).toBe(2) // Inner re-renders
    expect(screen.getByTestId('inner').textContent).toBe('20')

    // Update outer - Outer re-renders, causing Inner to re-render
    await act(async () => {
      update({ $set: { outer: 2 } })
      await flushMicrotasks()
    })

    expect(outerRenders).toBe(2)
    expect(innerRenders).toBe(3) // Re-renders due to parent
    expect(screen.getByTestId('outer').textContent).toBe('2')
  })

  it('should clean up properly on unmount', async () => {
    const [store, update] = createStore({ value: 'test' })
    let renders = 0

    function Component() {
      const track = useReactive()
      renders++
      const value = track(() => store.value)
      return <div data-testid="value">{value}</div>
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
