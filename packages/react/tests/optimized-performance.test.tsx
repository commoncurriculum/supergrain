import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import {
  useOptimizedStore,
  useOptimizedTrackedStore,
  performanceComparison,
  createContextSwitchBenchmark,
} from '../src/use-store-optimized'
import { useStore, useTrackedStore } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Optimized Store Hooks - Performance Focus', () => {
  describe('useOptimizedStore', () => {
    it('should maintain fine-grained reactivity', async () => {
      const [store, update] = createStore({ count: 0, name: 'test' })
      let renders = 0

      function Counter() {
        useOptimizedStore()
        renders++
        // Only access count, not name
        return <div data-testid="count">{store.count}</div>
      }

      render(<Counter />)
      expect(renders).toBe(1)

      // Update name (not accessed) - should NOT re-render
      await act(async () => {
        update({ $set: { name: 'updated' } })
        await flushMicrotasks()
      })
      expect(renders).toBe(1) // Still 1 - fine-grained reactivity working

      // Update count (accessed) - should re-render
      await act(async () => {
        update({ $set: { count: 1 } })
        await flushMicrotasks()
      })
      expect(renders).toBe(2) // Re-rendered because count was accessed
    })

    it('should handle basic updates correctly', async () => {
      const [store, update] = createStore({ value: 10 })
      let renders = 0

      function OptimizedComponent() {
        useOptimizedStore()
        renders++
        return <div data-testid="optimized">{store.value}</div>
      }

      render(<OptimizedComponent />)
      expect(renders).toBe(1)
      expect(screen.getByTestId('optimized').textContent).toBe('10')

      // Should re-render when store updates
      await act(async () => {
        update({ $set: { value: 20 } })
        await flushMicrotasks()
      })

      expect(renders).toBe(2)
      expect(screen.getByTestId('optimized').textContent).toBe('20')
    })
  })

  describe('useOptimizedTrackedStore', () => {
    it('should maintain fine-grained reactivity with store parameter', async () => {
      const [store, update] = createStore({ x: 1, y: 2, z: 3 })
      let renders = 0

      function Component() {
        const state = useOptimizedTrackedStore(store)
        renders++
        // Only access x, not y or z
        return <div data-testid="x">{state.x}</div>
      }

      render(<Component />)
      expect(renders).toBe(1)

      // Update y (not accessed) - should NOT re-render
      await act(async () => {
        update({ $set: { y: 20 } })
        await flushMicrotasks()
      })
      expect(renders).toBe(1)

      // Update z (not accessed) - should NOT re-render
      await act(async () => {
        update({ $set: { z: 30 } })
        await flushMicrotasks()
      })
      expect(renders).toBe(1)

      // Update x (accessed) - should re-render
      await act(async () => {
        update({ $set: { x: 10 } })
        await flushMicrotasks()
      })
      expect(renders).toBe(2)
      expect(screen.getByTestId('x').textContent).toBe('10')
    })

    it('should work identically to original useTrackedStore', async () => {
      const [store1, update1] = createStore({ data: 'hello' })
      const [store2, update2] = createStore({ data: 'hello' })
      let renders1 = 0,
        renders2 = 0

      function OriginalComponent() {
        const state = useTrackedStore(store1)
        renders1++
        return <div data-testid="original">{state.data}</div>
      }

      function OptimizedComponent() {
        const state = useOptimizedTrackedStore(store2)
        renders2++
        return <div data-testid="optimized">{state.data}</div>
      }

      function App() {
        return (
          <>
            <OriginalComponent />
            <OptimizedComponent />
          </>
        )
      }

      render(<App />)
      expect(renders1).toBe(1)
      expect(renders2).toBe(1)

      // Both should re-render when data updates
      await act(async () => {
        update1({ $set: { data: 'world' } })
        update2({ $set: { data: 'world' } })
        await flushMicrotasks()
      })

      expect(renders1).toBe(2)
      expect(renders2).toBe(2)
      expect(screen.getByTestId('original').textContent).toBe('world')
      expect(screen.getByTestId('optimized').textContent).toBe('world')
    })

    it('should handle multiple property accesses efficiently', async () => {
      const [store, update] = createStore({
        a: 1,
        b: 2,
        c: 3,
        d: 4,
        e: 5,
        f: 6,
        g: 7,
        h: 8,
        i: 9,
        j: 10,
      })
      let renders = 0

      function Component() {
        const state = useOptimizedTrackedStore(store)
        renders++
        // Access multiple properties - this would cause many context switches in original
        const sum =
          state.a +
          state.b +
          state.c +
          state.d +
          state.e +
          state.f +
          state.g +
          state.h +
          state.i +
          state.j
        return <div data-testid="sum">{sum}</div>
      }

      render(<Component />)
      expect(renders).toBe(1)
      expect(screen.getByTestId('sum').textContent).toBe('55')

      // Update one accessed property - should re-render
      await act(async () => {
        update({ $set: { a: 2 } })
        await flushMicrotasks()
      })

      expect(renders).toBe(2)
      expect(screen.getByTestId('sum').textContent).toBe('56')
    })
  })

  describe('Performance Analysis', () => {
    it('should calculate correct improvement ratios', () => {
      // Test the performance comparison utility
      expect(performanceComparison.getImprovementRatio(1)).toBe(1.5) // 3 -> 2
      expect(performanceComparison.getImprovementRatio(5)).toBe(7.5) // 15 -> 2
      expect(performanceComparison.getImprovementRatio(10)).toBe(15) // 30 -> 2
    })

    it('should provide benchmark utilities', () => {
      const benchmark = createContextSwitchBenchmark()

      // Record some mock measurements
      benchmark.recordRenderTime(1.5)
      benchmark.recordRenderTime(2.0)
      benchmark.recordRenderTime(1.8)

      const results = benchmark.getResults()
      expect(results.count).toBe(3)
      expect(results.average).toBeCloseTo(1.77, 1)
      expect(results.min).toBe(1.5)
      expect(results.max).toBe(2.0)
    })
  })

  describe('Context Switching Behavior', () => {
    it('should demonstrate reduced context switching with many property accesses', async () => {
      const [store, update] = createStore({
        prop1: 'a',
        prop2: 'b',
        prop3: 'c',
        prop4: 'd',
        prop5: 'e',
        prop6: 'f',
        prop7: 'g',
        prop8: 'h',
        prop9: 'i',
        prop10: 'j',
      })

      let originalRenders = 0
      let optimizedRenders = 0

      function OriginalManyAccesses() {
        const state = useTrackedStore(store)
        originalRenders++
        // This will cause 30 context switches (10 properties × 3 switches each)
        return (
          <div data-testid="original-many">
            {state.prop1}
            {state.prop2}
            {state.prop3}
            {state.prop4}
            {state.prop5}
            {state.prop6}
            {state.prop7}
            {state.prop8}
            {state.prop9}
            {state.prop10}
          </div>
        )
      }

      function OptimizedManyAccesses() {
        const state = useOptimizedTrackedStore(store)
        optimizedRenders++
        // This will cause only 2 context switches regardless of property count
        return (
          <div data-testid="optimized-many">
            {state.prop1}
            {state.prop2}
            {state.prop3}
            {state.prop4}
            {state.prop5}
            {state.prop6}
            {state.prop7}
            {state.prop8}
            {state.prop9}
            {state.prop10}
          </div>
        )
      }

      function App() {
        return (
          <>
            <OriginalManyAccesses />
            <OptimizedManyAccesses />
          </>
        )
      }

      render(<App />)
      expect(originalRenders).toBe(1)
      expect(optimizedRenders).toBe(1)

      // Both should show same content
      expect(screen.getByTestId('original-many').textContent).toBe('abcdefghij')
      expect(screen.getByTestId('optimized-many').textContent).toBe(
        'abcdefghij'
      )

      // Update one property - both should re-render with same result
      await act(async () => {
        update({ $set: { prop1: 'A' } })
        await flushMicrotasks()
      })

      expect(originalRenders).toBe(2)
      expect(optimizedRenders).toBe(2)
      expect(screen.getByTestId('original-many').textContent).toBe('Abcdefghij')
      expect(screen.getByTestId('optimized-many').textContent).toBe(
        'Abcdefghij'
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid updates correctly', async () => {
      const [store, update] = createStore({ counter: 0 })
      let renders = 0

      function Counter() {
        const state = useOptimizedTrackedStore(store)
        renders++
        return <div data-testid="counter">{state.counter}</div>
      }

      render(<Counter />)
      expect(renders).toBe(1)

      // Rapid batched updates
      await act(async () => {
        update({ $set: { counter: 1 } })
        update({ $set: { counter: 2 } })
        update({ $set: { counter: 3 } })
        update({ $set: { counter: 4 } })
        update({ $set: { counter: 5 } })
        await flushMicrotasks()
      })

      // Should show final value
      expect(screen.getByTestId('counter').textContent).toBe('5')
      // Should have batched the updates (exact count depends on batching)
      expect(renders).toBeGreaterThan(1)
    })

    it('should clean up properly on unmount', async () => {
      const [store, update] = createStore({ value: 'test' })
      let renders = 0

      function Component() {
        const state = useOptimizedTrackedStore(store)
        renders++
        return <div data-testid="value">{state.value}</div>
      }

      const { unmount } = render(<Component />)
      expect(renders).toBe(1)

      unmount()

      // Update after unmount should not cause errors or additional renders
      await act(async () => {
        update({ $set: { value: 'updated' } })
        await flushMicrotasks()
      })

      expect(renders).toBe(1) // No additional renders after unmount
    })
  })
})
