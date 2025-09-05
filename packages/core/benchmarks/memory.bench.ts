import { bench, describe } from 'vitest'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect, createRoot } from 'solid-js'

describe('Memory Benchmarks', () => {
  bench('baseline: creating a new store', () => {
    const [store] = createStore({ value: 0 })
    // Access to ensure proxy is created
    const _ = store.value
  })

  bench('scaling: memory usage for 10,000 entities', () => {
    const entities: any[] = []
    for (let i = 0; i < 10000; i++) {
      const [store] = createStore({
        id: i,
        name: `Entity ${i}`,
        value: i * 2,
        metadata: {
          created: Date.now(),
          updated: Date.now(),
        },
      })
      entities.push(store)
    }
    // Keep reference to prevent GC
    entities.length
  })

  bench('subscriptions: memory usage for 5,000 entities with effects', () => {
    const disposers: (() => void)[] = []

    for (let i = 0; i < 5000; i++) {
      const [store] = createStore({
        id: i,
        value: i * 2,
      })

      disposers.push(
        effect(() => {
          const _ = store.value
        })
      )
    }

    // Clean up
    disposers.forEach(d => d())
  })

  bench('leak test: create and destroy 10,000 effects', () => {
    const [store] = createStore({ counter: 0 })

    for (let i = 0; i < 10000; i++) {
      const dispose = effect(() => {
        const _ = store.counter
      })
      dispose()
    }
  })

  bench('solid-js comparison: 10,000 entities', () => {
    const entities: any[] = []

    createRoot(dispose => {
      for (let i = 0; i < 10000; i++) {
        const [store] = createSolidStore({
          id: i,
          name: `Entity ${i}`,
          value: i * 2,
          metadata: {
            created: Date.now(),
            updated: Date.now(),
          },
        })
        entities.push(store)
      }

      // Keep reference to prevent GC
      entities.length

      dispose()
    })
  })

  bench('solid-js: 5,000 entities with effects', () => {
    createRoot(dispose => {
      for (let i = 0; i < 5000; i++) {
        const [store] = createSolidStore({
          id: i,
          value: i * 2,
        })

        createEffect(() => {
          const _ = store.value
        })
      }

      dispose()
    })
  })
})
