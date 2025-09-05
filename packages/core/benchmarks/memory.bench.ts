import { bench, describe } from 'vitest'
import { ReactiveStore } from '../src/store'
import { effect } from 'alien-signals'

// Note: These benchmarks are designed to be run with a memory profiler
// to analyze memory usage and potential leaks. Direct memory measurement
// is not integrated into vitest's benchmarking capabilities. A developer
// can use Node.js's --inspect flag and Chrome DevTools to profile memory.

describe('Memory Benchmarks', () => {
  bench('baseline: creating a new ReactiveStore', () => {
    // This benchmark measures the baseline memory cost of a single store instance.
    const store = new ReactiveStore()
  })

  bench('scaling: memory usage for 10,000 entities', () => {
    // This benchmark helps analyze how memory scales with the number of entities.
    const store = new ReactiveStore()
    for (let i = 0; i < 10000; i++) {
      store.set('users', i, {
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
      })
    }
  })

  bench('subscriptions: memory usage for 5,000 entities with effects', () => {
    // This benchmark analyzes the memory overhead of subscriptions (effects).
    const store = new ReactiveStore()
    const disposers: (() => void)[] = []

    // Create entities and subscribe to a property on each
    for (let i = 0; i < 5000; i++) {
      store.set('users', i, { name: `User ${i}` })
      const user = store.find('users', i)!()

      const dispose = effect(() => {
        // Access a property to create a subscription
        const name = user.name
      })
      disposers.push(dispose)
    }

    // In a real memory test, you would take a heap snapshot here.
    // Then, call all disposers, trigger garbage collection, and take
    // another snapshot to ensure the effects have been cleaned up.
    for (const dispose of disposers) {
      dispose()
    }
  })

  bench('leak test: create and destroy 10,000 effects', () => {
    const store = new ReactiveStore()
    store.set('counters', 'a', { value: 0 })
    const counter = store.find('counters', 'a')!()

    // This loop creates and immediately destroys effects. When run with a
    // memory profiler, the memory usage should remain stable. A steady
    // increase would indicate a memory leak in the effect subscription/cleanup.
    for (let i = 0; i < 10000; i++) {
      const dispose = effect(() => {
        const value = counter.value
      })
      dispose() // Immediately clean up the effect
    }
  })
})
