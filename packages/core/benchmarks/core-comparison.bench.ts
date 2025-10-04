import { bench, describe } from 'vitest'
import { createStore } from '../src'
import { effect } from 'alien-signals'
// Import browser builds explicitly to enable reactivity in Node.js
import { createRoot, createEffect, batch } from 'solid-js/dist/solid.js'
import { createStore as createSolidStore } from 'solid-js/store/dist/store.js'
import { testEffect } from '@solidjs/testing-library'

function validationError(message: string) {
  console.warn(message)
  throw new Error(message)
}

/**
 * Core benchmarks for comparing @supergrain/core with solid-js.
 *
 * IMPORTANT NOTES:
 * 1. Solid.js requires browser builds for reactivity in Node.js (solid-js/dist/solid.js).
 * 2. Benchmarks use manual `createRoot` and `dispose` for SolidJS to provide a
 *    fairer comparison against supergrain's manual effect disposal, avoiding
 *    testing-library overhead.
 * 3. Solid's `createStore` is used for object/deep reactivity comparisons,
 *    while `createSignal` is used for primitive value comparisons where appropriate.
 * 4. All batched updates are awaited with a microtask to ensure effects have run.
 */

describe('Core: Store Creation', () => {
  bench('@supergrain/core: create 1000 stores', () => {
    for (let i = 0; i < 1000; i++) {
      createStore({
        id: i,
        name: `Item ${i}`,
        nested: { count: i },
      })
    }
  })

  bench('solid-js/store: create 1000 stores', () => {
    createRoot((dispose: () => void) => {
      for (let i = 0; i < 1000; i++) {
        createSolidStore({
          id: i,
          name: `Item ${i}`,
          nested: { count: i },
        })
      }
      dispose()
    })
  })
})

describe('Core: Property Access (Non-reactive)', () => {
  const [storableStore] = createStore({ user: { age: 30 } })
  let solidStore: any
  createRoot((dispose: () => void) => {
    ;[solidStore] = createSolidStore({ user: { age: 30 } })
    dispose()
  })

  bench('@supergrain/core: 1M non-reactive reads', () => {
    for (let i = 0; i < 1000000; i++) {
      storableStore.user.age
    }
  })

  bench('solid-js/store: 1M non-reactive reads', () => {
    for (let i = 0; i < 1000000; i++) {
      solidStore.user.age
    }
  })
})

describe('Core: Reactive Effect Creation', () => {
  bench('@supergrain/core: create effect with 10k property reads', () => {
    const [store] = createStore({ value: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      for (let i = 0; i < 10000; i++) {
        store.value
      }
    })
    if (runs !== 1) {
      validationError(`[@supergrain/core] Unexpected initial runs: ${runs}`)
    }
    dispose()
  })

  bench('solid-js/store: create effect with 10k property reads', async () => {
    await testEffect(done => {
      const [store] = createSolidStore({ value: 0 })
      let runs = 0
      createEffect(() => {
        runs++
        for (let i = 0; i < 10000; i++) {
          store.value
        }
        if (runs === 1) done()
      })
    })
  })
})

describe('Core: Property Updates with Effects', () => {
  bench('@supergrain/core: 1000 sequential updates', async () => {
    const [store, setStore] = createStore({ count: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.count
    })

    if (runs !== 1) {
      validationError(
        `[@supergrain/core] Initial effect did not run. Runs: ${runs}`
      )
    }

    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i + 1 } })
    }

    await new Promise<void>(resolve => queueMicrotask(() => resolve()))

    if (runs !== 2) {
      validationError(
        `[@supergrain/core] Expected 2 runs for batched updates, got ${runs}`
      )
    }
    dispose()
  })

  bench('solid-js/store: 1000 batched updates', async () => {
    await testEffect(done => {
      const [store, setStore] = createSolidStore({ count: 0 })
      let runs = 0

      createEffect(() => {
        runs++
        store.count

        if (runs === 1) {
          // Initial run complete, perform batch updates
          batch(() => {
            for (let i = 0; i < 1000; i++) {
              setStore('count', i + 1)
            }
          })
        } else if (runs === 2) {
          // Batch complete
          done()
        }
      })

      // Fallback timeout
      setTimeout(() => done(), 100)
    })
  })
})

describe('Core: Batch Updates', () => {
  bench('@supergrain/core: batch update 3 properties', async () => {
    const [store, setStore] = createStore({ a: 0, b: 0, c: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.a
      store.b
      store.c
    })

    setStore({ $set: { a: 1, b: 2, c: 3 } })

    await new Promise<void>(resolve => queueMicrotask(() => resolve()))

    if (runs !== 2) {
      validationError(`[@supergrain/core] Expected 2 runs, got ${runs}`)
    }
    dispose()
  })

  bench('solid-js/store: batch update 3 properties', async () => {
    await testEffect(done => {
      const [store, setStore] = createSolidStore({ a: 0, b: 0, c: 0 })
      let runs = 0

      createEffect(() => {
        runs++
        store.a
        store.b
        store.c

        if (runs === 1) {
          // Initial run complete, perform batch
          batch(() => {
            setStore({ a: 1, b: 2, c: 3 })
          })
        } else if (runs === 2) {
          // Batch complete
          done()
        }
      })

      setTimeout(() => done(), 100)
    })
  })
})

describe('Core: Array Operations', () => {
  bench('@supergrain/core: 100 array pushes', async () => {
    const [store, update] = createStore<{ items: number[] }>({ items: [] })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.items.length
    })

    for (let i = 0; i < 100; i++) {
      update({ $push: { items: i } })
    }

    await new Promise<void>(resolve => queueMicrotask(() => resolve()))

    if (runs !== 2) {
      validationError(`[@supergrain/core] Expected 2 runs, got ${runs}`)
    }
    dispose()
  })

  bench('solid-js/store: 100 array pushes', async () => {
    await testEffect(done => {
      const [store, setStore] = createSolidStore<{ items: number[] }>({
        items: [],
      })
      let runs = 0

      createEffect(() => {
        runs++
        store.items.length

        if (runs === 1) {
          batch(() => {
            for (let i = 0; i < 100; i++) {
              setStore('items', (items: number[]) => [...items, i])
            }
          })
        } else if (runs === 2) {
          done()
        }
      })

      // Fallback timeout
      setTimeout(() => done(), 100)
    })
  })
})

describe('Core: Deep Updates', () => {
  const getDeepState = () => ({ l1: { l2: { l3: { value: 0 } } } })

  bench('@supergrain/core: 100 deep updates', async () => {
    const [store, setStore] = createStore(getDeepState())
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.l1.l2.l3.value
    })

    for (let i = 0; i < 100; i++) {
      setStore({ $set: { 'l1.l2.l3.value': i + 1 } })
    }

    await new Promise<void>(resolve => queueMicrotask(() => resolve()))

    if (runs !== 2) {
      validationError(`[@supergrain/core] Expected 2 runs, got ${runs}`)
    }
    dispose()
  })

  bench('solid-js/store: 100 deep updates', async () => {
    await testEffect(done => {
      const [store, setStore] = createSolidStore(getDeepState())
      let runs = 0

      createEffect(() => {
        runs++
        store.l1.l2.l3.value

        if (runs === 1) {
          batch(() => {
            for (let i = 0; i < 100; i++) {
              setStore('l1', 'l2', 'l3', 'value', i + 1)
            }
          })
        } else if (runs === 2) {
          done()
        }
      })

      // Fallback timeout
      setTimeout(() => done(), 100)
    })
  })
})

describe('Core: Granular Reactivity', () => {
  bench(
    '@supergrain/core: update one property in object with 10 properties',
    async () => {
      const data: any = {}
      for (let i = 0; i < 10; i++) data[`prop${i}`] = { nested: i }
      const [store, setStore] = createStore(data)
      const runs = Array(10).fill(0)
      const disposers: (() => void)[] = []

      for (let i = 0; i < 10; i++) {
        const index = i
        disposers.push(
          effect(() => {
            store[`prop${index}`].nested
            runs[index]++
          })
        )
      }

      // Effects run once on creation.
      if (runs.some(r => r !== 1)) {
        validationError(
          `[@supergrain/core] Unexpected initial runs: ${runs.join(', ')}`
        )
      }

      setStore({ $set: { 'prop5.nested': 999 } })

      await new Promise<void>(resolve => queueMicrotask(() => resolve()))

      const passed = runs[5] === 2 && runs.every((r, i) => i === 5 || r === 1)
      if (!passed) {
        validationError(
          `[@supergrain/core] Expected only one effect to run. Runs: ${runs.join(
            ', '
          )}`
        )
      }

      disposers.forEach(d => d())
    }
  )

  bench(
    'solid-js/store: update one property in object with 10 properties',
    async () => {
      await testEffect(done => {
        const data: any = {}
        for (let i = 0; i < 10; i++) data[`prop${i}`] = { nested: i }
        const [store, setStore] = createSolidStore(data)

        // The property we will check is prop5
        createEffect(() => {
          let runs = 0
          // Re-run this effect when prop5 is updated
          store.prop5.nested
          runs++

          if (runs === 1) {
            // All effects have run once. Now update.
            setStore('prop5', 'nested', 999)
          } else if (runs === 2) {
            // The update has propagated and this effect has re-run.
            // We can now safely finish the benchmark.
            done()
          }
        })

        setTimeout(() => done(), 100)
      })
    }
  )
})

/**
 * Non-reactive Store Operations
 * These benchmarks compare store manipulation without reactive effects
 */
describe('Core: Non-reactive Store Operations', () => {
  bench('@supergrain/core: 1000 non-reactive updates', () => {
    const [_store, setStore] = createStore({ count: 0 })
    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i + 1 } })
    }
  })

  bench('solid-js/store: 1000 non-reactive updates', () => {
    createRoot((dispose: () => void) => {
      const [_store, setStore] = createSolidStore({ count: 0 })
      for (let i = 0; i < 1000; i++) {
        setStore('count', i + 1)
      }
      dispose()
    })
  })
})
