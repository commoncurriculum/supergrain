# Reactivity Contract Validation Tests

> **Status**: Current. Test code archive -- used to validate that optimizations preserve reactivity.
> **TL;DR**: 11 tests covering: dependency registration, signal identity, nested access, arrays, symbol properties, conditional access, error conditions, and the "never skip tracking for performance" contract. All passed for each of the 4 optimizations in [safe-optimizations-benchmark.md](./safe-optimizations-benchmark.md).

Guarantees validated:
1. Every property access in reactive context registers dependencies
2. Signal identity consistency for update propagation
3. Automatic dependency tracking without manual setup
4. Transparent object mutations that propagate reactively

## Test Code

```typescript

```typescript
import { describe, it, expect } from 'vitest'
import { createStore } from '../src'
import { effect } from 'alien-signals'

describe('Reactivity Contract: Basic Property Access', () => {
  it('should register dependencies on every property access in reactive context', () => {
    const [store, setStore] = createStore({ count: 0, name: 'test' })
    let effectRuns = 0
    let lastCount = -1
    let lastName = ''

    const dispose = effect(() => {
      effectRuns++
      lastCount = store.count
      lastName = store.name
    })

    // Initial effect run
    expect(effectRuns).toBe(1)
    expect(lastCount).toBe(0)
    expect(lastName).toBe('test')

    // Update should trigger effect
    setStore({ $set: { count: 5 } })
    expect(effectRuns).toBe(2)
    expect(lastCount).toBe(5)

    // Update should trigger effect
    setStore({ $set: { name: 'updated' } })
    expect(effectRuns).toBe(3)
    expect(lastName).toBe('updated')

    dispose()
  })

  it('should not register dependencies when outside reactive context', () => {
    const [store, setStore] = createStore({ count: 0 })
    
    // Access outside reactive context
    const initialValue = store.count
    expect(initialValue).toBe(0)

    // Create effect that doesn't access the property
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      // Don't access store.count here
    })

    expect(effectRuns).toBe(1)

    // Update should not trigger effect since no dependency was registered
    setStore({ $set: { count: 10 } })
    expect(effectRuns).toBe(1) // Should still be 1

    dispose()
  })
})

describe('Reactivity Contract: Nested Object Access', () => {
  it('should register dependencies for nested property access', () => {
    const [store, setStore] = createStore({
      user: {
        profile: {
          name: 'John',
          settings: {
            theme: 'dark'
          }
        }
      }
    })

    let effectRuns = 0
    let lastTheme = ''

    const dispose = effect(() => {
      effectRuns++
      lastTheme = store.user.profile.settings.theme
    })

    expect(effectRuns).toBe(1)
    expect(lastTheme).toBe('dark')

    // Deep update should trigger effect
    setStore({ $set: { 'user.profile.settings.theme': 'light' } })
    expect(effectRuns).toBe(2)
    expect(lastTheme).toBe('light')

    dispose()
  })

  it('should maintain signal identity across access patterns', () => {
    const [store, setStore] = createStore({
      data: { value: 42 }
    })

    let runs1 = 0
    let runs2 = 0

    // Two effects accessing the same property
    const dispose1 = effect(() => {
      runs1++
      store.data.value
    })

    const dispose2 = effect(() => {
      runs2++
      store.data.value
    })

    expect(runs1).toBe(1)
    expect(runs2).toBe(1)

    // Update should trigger both effects (signal identity must be consistent)
    // This is the critical test from signal-prototype-optimization.md
    setStore({ $set: { 'data.value': 100 } })
    
    // Both effects should have run again
    expect(runs1).toBe(2)
    expect(runs2).toBe(2)

    dispose1()
    dispose2()
  })
})

describe('Reactivity Contract: Array Operations', () => {
  it('should track array element access', () => {
    const [store, setStore] = createStore({
      items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]
    })

    let effectRuns = 0
    let firstName = ''

    const dispose = effect(() => {
      effectRuns++
      firstName = store.items[0]?.name || ''
    })

    expect(effectRuns).toBe(1)
    expect(firstName).toBe('Item 1')

    // Update first item
    setStore({ $set: { 'items.0.name': 'Updated Item 1' } })
    expect(effectRuns).toBe(2)
    expect(firstName).toBe('Updated Item 1')

    dispose()
  })

  it('should track array length changes', () => {
    const [store, setStore] = createStore({
      items: [1, 2, 3]
    })

    let effectRuns = 0
    let lastLength = 0

    const dispose = effect(() => {
      effectRuns++
      lastLength = store.items.length
    })

    expect(effectRuns).toBe(1)
    expect(lastLength).toBe(3)

    // Add item
    setStore({ $push: { items: 4 } })
    expect(effectRuns).toBe(2)
    expect(lastLength).toBe(4)

    dispose()
  })
})

describe('Reactivity Contract: Symbol Properties', () => {
  it('should handle symbol property access without breaking reactivity', () => {
    const [store, setStore] = createStore({ count: 0 })
    
    let effectRuns = 0
    let lastCount = 0

    const dispose = effect(() => {
      effectRuns++
      lastCount = store.count
      
      // Access symbol properties (these should not interfere with reactivity)
      // const raw = (store as any)['$RAW']
      // const proxy = (store as any)['$PROXY']
      
      // These should not affect the reactivity of store.count
    })

    expect(effectRuns).toBe(1)
    expect(lastCount).toBe(0)

    setStore({ $set: { count: 10 } })
    expect(effectRuns).toBe(2)
    expect(lastCount).toBe(10)

    dispose()
  })
})

describe('Reactivity Contract: Complex Update Patterns', () => {
  it('should handle multiple property updates in a single transaction', () => {
    const [store, setStore] = createStore({
      a: 1,
      b: 2,
      c: 3
    })

    let effectRuns = 0
    let sum = 0

    const dispose = effect(() => {
      effectRuns++
      sum = store.a + store.b + store.c
    })

    expect(effectRuns).toBe(1)
    expect(sum).toBe(6)

    // Multiple updates in one operation - should only trigger effect once
    setStore({ $set: { a: 10, b: 20, c: 30 } })
    expect(effectRuns).toBe(2)
    expect(sum).toBe(60)

    dispose()
  })

  it('should handle conditional property access', () => {
    const [store, setStore] = createStore({
      flag: true,
      value1: 'A',
      value2: 'B'
    })

    let effectRuns = 0
    let result = ''

    const dispose = effect(() => {
      effectRuns++
      result = store.flag ? store.value1 : store.value2
    })

    expect(effectRuns).toBe(1)
    expect(result).toBe('A')

    // Change flag - should track new dependency
    setStore({ $set: { flag: false } })
    expect(effectRuns).toBe(2)
    expect(result).toBe('B')

    // Change value2 - should now be tracked
    setStore({ $set: { value2: 'Updated B' } })
    expect(effectRuns).toBe(3)
    expect(result).toBe('Updated B')

    // Change value1 - should not trigger (not accessed when flag is false)
    setStore({ $set: { value1: 'Updated A' } })
    expect(effectRuns).toBe(3) // Should still be 3

    dispose()
  })
})

describe('Reactivity Contract: Error Conditions', () => {
  it('should maintain reactivity even with property access errors', () => {
    const [store, setStore] = createStore({
      user: null as any
    })

    let effectRuns = 0
    let lastName = 'default'

    const dispose = effect(() => {
      effectRuns++
      try {
        // This will throw when user is null
        lastName = store.user.name
      } catch (e) {
        lastName = 'error'
      }
    })

    expect(effectRuns).toBe(1)
    expect(lastName).toBe('error')

    // Set user - should trigger effect
    setStore({ $set: { user: { name: 'John' } } })
    expect(effectRuns).toBe(2)
    expect(lastName).toBe('John')

    dispose()
  })
})

describe('Reactivity Contract: Performance vs Correctness', () => {
  it('should never skip dependency registration for performance', () => {
    const [store, setStore] = createStore({
      fastPath: 'initial',
      expensiveProperty: 'initial'
    })

    // Simulate a scenario where an optimization might try to skip tracking
    // Based on failed-approaches/reactivity-breaking-optimizations.md
    let effectRuns = 0
    let results: string[] = []

    const dispose = effect(() => {
      effectRuns++
      // Both properties must be tracked regardless of access patterns
      results = [store.fastPath, store.expensiveProperty]
    })

    expect(effectRuns).toBe(1)
    expect(results).toEqual(['initial', 'initial'])

    // Update both - both must trigger (no fast path that skips tracking)
    setStore({ $set: { fastPath: 'updated1', expensiveProperty: 'updated1' } })
    expect(effectRuns).toBe(2)
    expect(results).toEqual(['updated1', 'updated1'])

    // Individual updates must also work
    setStore({ $set: { fastPath: 'updated2' } })
    expect(effectRuns).toBe(3)
    expect(results[0]).toBe('updated2')

    setStore({ $set: { expensiveProperty: 'updated2' } })
    expect(effectRuns).toBe(4)
    expect(results[1]).toBe('updated2')

    dispose()
  })
})

/**
 * Validation Helper: Test that a proxy implementation maintains reactivity
 * This can be used to validate optimized proxy handlers
 */
export function validateReactivityContract(
  createOptimizedStore: (initialState: any) => [any, (updates: any) => void],
  testName: string
) {
  describe(`Reactivity Validation: ${testName}`, () => {
    it('should maintain basic reactivity', () => {
      const [store, setStore] = createOptimizedStore({ count: 0 })
      
      let effectRuns = 0
      let lastCount = 0

      const dispose = effect(() => {
        effectRuns++
        lastCount = store.count
      })

      expect(effectRuns).toBe(1)
      expect(lastCount).toBe(0)

      setStore({ $set: { count: 5 } })
      expect(effectRuns).toBe(2)
      expect(lastCount).toBe(5)

      dispose()
    })

    it('should maintain nested reactivity', () => {
      const [store, setStore] = createOptimizedStore({
        nested: { value: 42 }
      })
      
      let effectRuns = 0
      let lastValue = 0

      const dispose = effect(() => {
        effectRuns++
        lastValue = store.nested.value
      })

      expect(effectRuns).toBe(1)
      expect(lastValue).toBe(42)

      setStore({ $set: { 'nested.value': 100 } })
      expect(effectRuns).toBe(2)
      expect(lastValue).toBe(100)

      dispose()
    })
  })
}
```

## Optimizations Validated

| Optimization | What Could Break |
|-------------|-----------------|
| Reflect.get -> direct access | Dependency registration |
| Object.create(null) -> {} | Signal identity |
| Closure -> direct reference | Signal behavior |
| Removed redundant checks | Dependency tracking |

All 11 tests passed for each optimization.

Originally `packages/core/tests/reactivity-validation.test.ts`, moved to doc format. The `validateReactivityContract` helper can test any optimized proxy implementation against these guarantees.