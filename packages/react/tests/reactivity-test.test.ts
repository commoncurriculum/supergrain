import { describe, it, expect } from 'vitest'
import { createStore, signal, effect } from '@storable/core'
import { flushMicrotasks } from './test-utils'

describe('Store Reactivity Tests', () => {
  it('should test if signals work directly', () => {
    // Test plain signals first
    const count = signal(0)
    let effectRuns = 0

    const cleanup = effect(() => {
      const value = count()
      effectRuns++
      console.log(`Signal effect run #${effectRuns}, value = ${value}`)
    })

    expect(effectRuns).toBe(1)

    // Update signal directly
    count(5)
    expect(effectRuns).toBe(2)

    count(10)
    expect(effectRuns).toBe(3)

    cleanup()
  })

  it('should test if store properties are signals', () => {
    const [store] = createStore({ count: 0 })

    // Try to access the underlying signal if possible
    console.log('store:', store)
    console.log('store.count:', store.count)
    console.log('typeof store.count:', typeof store.count)

    // Check if store.count behaves like a signal
    if (typeof store.count === 'function') {
      console.log('store.count is a function (signal)')
      console.log('store.count():', store.count())
    } else {
      console.log('store.count is not a function, value:', store.count)
    }
  })

  it('should test store reactivity with direct property mutation', () => {
    const [store] = createStore({ value: 'initial' })
    let effectRuns = 0

    const cleanup = effect(() => {
      // Access store property inside effect
      const val = store.value
      effectRuns++
      console.log(`Store effect run #${effectRuns}, value = ${val}`)
    })

    expect(effectRuns).toBe(1)

    // Try to mutate directly (we know this throws, but let's catch it)
    try {
      store.value = 'changed'
      console.log('Direct mutation succeeded')
    } catch (e) {
      console.log('Direct mutation failed:', e.message)
    }

    console.log(`After mutation attempt, effectRuns = ${effectRuns}`)

    cleanup()
  })

  it('should test if store getter triggers dependency tracking', () => {
    const [store] = createStore({ num: 100 })

    // Create an effect
    let trackedValue = null
    let effectRuns = 0

    const cleanup = effect(() => {
      effectRuns++
      console.log(`Effect starting, run #${effectRuns}`)

      // Try different ways to access the property
      trackedValue = store.num
      console.log(`Accessed store.num = ${trackedValue}`)

      // Also try bracket notation
      const bracketValue = store['num']
      console.log(`Accessed store['num'] = ${bracketValue}`)
    })

    expect(effectRuns).toBe(1)
    expect(trackedValue).toBe(100)

    // Now let's see what happens when we update through the update function
    const [, update] = createStore({ num: 100 })

    // This won't work because it's a different store instance
    // We need to use the same update function

    cleanup()
  })

  it('should test store updates with the same store instance', async () => {
    const [store, update] = createStore({ counter: 0 })
    let effectRuns = 0
    let lastValue = null

    const cleanup = effect(() => {
      lastValue = store.counter
      effectRuns++
      console.log(`Effect run #${effectRuns}, counter = ${lastValue}`)
    })

    expect(effectRuns).toBe(1)
    expect(lastValue).toBe(0)

    console.log('Before update, effectRuns:', effectRuns)

    // Update using the update function
    update({ $set: { counter: 5 } })

    // Flush microtasks to ensure batched effects run
    await flushMicrotasks()

    console.log('After update, effectRuns:', effectRuns)
    console.log('After update, store.counter:', store.counter)
    console.log('After update, lastValue:', lastValue)

    // Check if the effect ran
    if (effectRuns === 1) {
      console.log('ERROR: Effect did not run after update!')
      console.log(
        'This means the store update is not triggering reactive effects'
      )
    } else {
      console.log('SUCCESS: Effect ran after update')
    }

    expect(store.counter).toBe(5) // Value should be updated
    expect(effectRuns).toBe(2) // Effect should have run twice

    cleanup()
  })

  it('should test if we can manually trigger reactivity', () => {
    const [store, update] = createStore({ data: 'test' })

    // Let's try to understand the store structure
    console.log('Store keys:', Object.keys(store))
    console.log('Store prototype:', Object.getPrototypeOf(store))
    console.log('Store descriptors:', Object.getOwnPropertyDescriptors(store))

    // Check for any hidden properties
    const symbols = Object.getOwnPropertySymbols(store)
    console.log('Store symbols:', symbols)
    symbols.forEach(sym => {
      console.log(`Symbol ${sym.toString()}:`, store[sym])
    })

    // Try to access any internal signal mechanism
    if (store['$NODE']) {
      console.log('Found $NODE:', store['$NODE'])
    }
    if (store['$PROXY']) {
      console.log('Found $PROXY:', store['$PROXY'])
    }
  })

  it('should test batch updates', () => {
    const [store, update] = createStore({ a: 1, b: 2, c: 3 })
    let effectRuns = 0

    const cleanup = effect(() => {
      // Access all properties
      const sum = store.a + store.b + store.c
      effectRuns++
      console.log(`Effect run #${effectRuns}, sum = ${sum}`)
    })

    expect(effectRuns).toBe(1)

    // Update multiple properties
    update({ $set: { a: 10, b: 20, c: 30 } })

    console.log('After batch update, effectRuns:', effectRuns)
    console.log('Values:', { a: store.a, b: store.b, c: store.c })

    cleanup()
  })
})
