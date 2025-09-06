import { bench, describe } from 'vitest'
import { createStore } from '../src'
import { effect } from 'alien-signals'
// Import browser builds explicitly to enable reactivity in Node.js
import {
  createRoot,
  createEffect,
  createSignal,
  batch,
} from 'solid-js/dist/solid.js'
import {
  createStore as createSolidStore,
  SetStoreFunction,
} from 'solid-js/store/dist/store.js'
import { testEffect } from '@solidjs/testing-library'

/**
 * Core benchmarks for comparing @storable/core with solid-js.
 *
 * IMPORTANT NOTES:
 * 1. Solid.js requires browser builds for reactivity in Node.js (solid-js/dist/solid.js).
 * 2. Benchmarks use manual `createRoot` and `dispose` for SolidJS to provide a
 *    fairer comparison against storable's manual effect disposal, avoiding
 *    testing-library overhead.
 * 3. Solid's `createStore` is used for object/deep reactivity comparisons,
 *    while `createSignal` is used for primitive value comparisons where appropriate.
 * 4. All batched updates are awaited with a microtask to ensure effects have run.
 */

describe('Core: Store Creation', () => {
  bench('@storable/core: create 1000 stores', () => {
    for (let i = 0; i < 1000; i++) {
      createStore({
        id: i,
        name: `Item ${i}`,
        nested: { count: i },
      })
    }
  })

  bench('solid-js/store: create 1000 stores', () => {
    createRoot(dispose => {
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
  createRoot(dispose => {
    ;[solidStore] = createSolidStore({ user: { age: 30 } })
    dispose()
  })

  bench('@storable/core: 1M non-reactive reads', () => {
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
  bench('@storable/core: create effect with 10k property reads', () => {
    const [store] = createStore({ value: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      for (let i = 0; i < 10000; i++) {
        store.value
      }
    })
    if (runs !== 1)
      console.warn(`[@storable/core] Unexpected initial runs: ${runs}`)
    dispose()
  })

  bench('solid-js: create effect with 10k signal reads', async () => {
    await testEffect(done => {
      const [signal] = createSignal(0)
      let runs = 0
      createEffect(() => {
        runs++
        for (let i = 0; i < 10000; i++) {
          signal()
        }
        if (runs === 1) done()
      })
    })
  })
})

describe('Core: Property Updates with Effects', () => {
  bench('@storable/core: 1000 sequential updates', async () => {
    const [store, setStore] = createStore({ count: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.count
    })

    if (runs !== 1) {
      console.warn(`[@storable/core] Initial effect did not run. Runs: ${runs}`)
    }

    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i + 1 } })
    }

    await new Promise(resolve => queueMicrotask(resolve))

    if (runs !== 2) {
      console.warn(
        `[@storable/core] Expected 2 runs for batched updates, got ${runs}`
      )
    }
    dispose()
  })

  bench('solid-js/store: 1000 batched updates', async () => {
    let dispose: () => void
    let runs = 0
    let setStore: SetStoreFunction<{ count: number }>

    createRoot(d => {
      dispose = d
      const [store, _setStore] = createSolidStore({ count: 0 })
      setStore = _setStore
      createEffect(() => {
        runs++
        store.count
      })
    })

    if (runs !== 1) {
      console.warn(`[solid-js] Initial effect did not run. Runs: ${runs}`)
    }

    batch(() => {
      for (let i = 0; i < 1000; i++) {
        setStore('count', i + 1)
      }
    })

    await new Promise(resolve => queueMicrotask(resolve))

    if (runs !== 2) {
      console.warn(
        `[solid-js] Expected 2 runs for batched updates, got ${runs}`
      )
    }
    dispose()
  })
})

describe('Core: Batch Updates', () => {
  bench('@storable/core: batch update 3 properties', async () => {
    const [store, setStore] = createStore({ a: 0, b: 0, c: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.a
      store.b
      store.c
    })

    setStore({ $set: { a: 1, b: 2, c: 3 } })

    await new Promise(resolve => queueMicrotask(resolve))

    if (runs !== 2) {
      console.warn(`[@storable/core] Expected 2 runs, got ${runs}`)
    }
    dispose()
  })

  bench('solid-js: batch update 3 signals', async () => {
    await testEffect(done => {
      const [a, setA] = createSignal(0)
      const [b, setB] = createSignal(0)
      const [c, setC] = createSignal(0)
      let runs = 0

      createEffect(() => {
        runs++
        a()
        b()
        c()

        if (runs === 1) {
          // Initial run complete, perform batch
          batch(() => {
            setA(1)
            setB(2)
            setC(3)
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
  bench('@storable/core: 100 array pushes', async () => {
    const [store, update] = createStore<{ items: number[] }>({ items: [] })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.items.length
    })

    for (let i = 0; i < 100; i++) {
      update({ $push: { items: i } })
    }

    await new Promise(resolve => queueMicrotask(resolve))

    if (runs !== 2) {
      console.warn(`[@storable/core] Expected 2 runs, got ${runs}`)
    }
    dispose()
  })

  bench('solid-js/store: 100 array pushes', async () => {
    let dispose: () => void
    let runs = 0
    let setStore: SetStoreFunction<{ items: number[] }>

    createRoot(d => {
      dispose = d
      const [store, _setStore] = createSolidStore<{ items: number[] }>({
        items: [],
      })
      setStore = _setStore
      createEffect(() => {
        runs++
        store.items.length
      })
    })

    if (runs !== 1) {
      console.warn(`[solid-js] Initial effect did not run. Runs: ${runs}`)
    }

    batch(() => {
      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }
    })

    await new Promise(resolve => queueMicrotask(resolve))

    if (runs !== 2) {
      console.warn(
        `[solid-js] Expected 2 runs for batched updates, got ${runs}`
      )
    }
    dispose()
  })
})

describe('Core: Deep Updates', () => {
  const getDeepState = () => ({ l1: { l2: { l3: { value: 0 } } } })

  bench('@storable/core: 100 deep updates', async () => {
    const [store, setStore] = createStore(getDeepState())
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.l1.l2.l3.value
    })

    for (let i = 0; i < 100; i++) {
      setStore({ $set: { 'l1.l2.l3.value': i + 1 } })
    }

    await new Promise(resolve => queueMicrotask(resolve))

    if (runs !== 2) {
      console.warn(`[@storable/core] Expected 2 runs, got ${runs}`)
    }
    dispose()
  })

  bench('solid-js/store: 100 deep updates', async () => {
    let dispose: () => void
    let runs = 0
    let setStore: SetStoreFunction<ReturnType<typeof getDeepState>>

    createRoot(d => {
      dispose = d
      const [store, _setStore] = createSolidStore(getDeepState())
      setStore = _setStore
      createEffect(() => {
        runs++
        store.l1.l2.l3.value
      })
    })

    if (runs !== 1) {
      console.warn(`[solid-js] Initial effect did not run. Runs: ${runs}`)
    }

    batch(() => {
      for (let i = 0; i < 100; i++) {
        setStore('l1', 'l2', 'l3', 'value', i + 1)
      }
    })

    await new Promise(resolve => queueMicrotask(resolve))

    if (runs !== 2) {
      console.warn(
        `[solid-js] Expected 2 runs for batched updates, got ${runs}`
      )
    }
    dispose()
  })
})

describe('Core: Granular Reactivity', () => {
  bench(
    '@storable/core: update one property in object with 10 properties',
    async () => {
      const data: any = {}
      for (let i = 0; i < 10; i++) data[`prop${i}`] = { nested: i }
      const [store, setStore] = createStore(data)

      const disposers: (() => void)[] = []
      let updateRuns = 0

      for (let i = 0; i < 10; i++) {
        disposers.push(
          effect(() => {
            store[`prop${i}`].nested
            if (i === 5) updateRuns++
          })
        )
      }

      setStore({ $set: { 'prop5.nested': 999 } })

      await new Promise(resolve => queueMicrotask(resolve))

      if (updateRuns !== 1) {
        console.warn(
          `[@storable/core] Expected 1 update run, got ${updateRuns}`
        )
      }

      disposers.forEach(d => d())
    }
  )

  bench(
    'solid-js/store: update one property in object with 10 properties',
    async () => {
      const data: any = {}
      for (let i = 0; i < 10; i++) data[`prop${i}`] = { nested: i }

      let dispose: () => void
      const runs = Array(10).fill(0)
      let setStore: SetStoreFunction<typeof data>

      createRoot(d => {
        dispose = d
        const [store, _setStore] = createSolidStore(data)
        setStore = _setStore

        for (let i = 0; i < 10; i++) {
          createEffect(() => {
            store[`prop${i}`].nested
            runs[i]++
          })
        }
      })

      // All effects run once initially.
      if (runs.some(r => r !== 1)) {
        console.warn(`[solid-js] Unexpected initial runs: ${runs.join(', ')}`)
      }

      setStore('prop5', 'nested', 999)

      await new Promise(resolve => queueMicrotask(resolve))

      const passed = runs[5] === 2 && runs.every((r, i) => i === 5 || r === 1)
      if (!passed) {
        console.warn(
          `[solid-js] Expected only one effect to run. Runs: ${runs.join(', ')}`
        )
      }

      dispose()
    }
  )
})

/**
 * Non-reactive Store Operations
 * These benchmarks compare store manipulation without reactive effects
 */
describe('Core: Non-reactive Store Operations', () => {
  bench('@storable/core: 1000 non-reactive updates', () => {
    const [store, setStore] = createStore({ count: 0 })
    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i + 1 } })
    }
  })

  bench('solid-js/store: 1000 non-reactive updates', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ count: 0 })
      for (let i = 0; i < 1000; i++) {
        setStore('count', i + 1)
      }
      dispose()
    })
  })
})
