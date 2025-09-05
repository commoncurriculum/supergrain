import { bench, describe } from 'vitest'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import { createComputed, createRoot } from 'solid-js'

describe('Reactive Property Access Performance (Correct)', () => {
  bench('@storable/core: setup effect with 10k reads', () => {
    const [store] = createStore({ value: 42 })
    let total = 0
    const dispose = effect(() => {
      for (let i = 0; i < 10000; i++) {
        total += store.value
      }
    })
    dispose()
  })

  bench('solid-js/store: setup effect with 10k reads', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ value: 42 })
      let total = 0
      createComputed(() => {
        for (let i = 0; i < 10000; i++) {
          total += store.value
        }
      })
      dispose()
    })
  })
})

describe('Reactive Update Performance (Correct)', () => {
  bench('@storable/core: 1000 updates with active effect', () => {
    const [store, setStore] = createStore({ count: 0 })
    let effectRuns = 0

    const dispose = effect(() => {
      const _ = store.count
      effectRuns++
    })

    for (let i = 0; i < 1000; i++) {
      setStore('count', i)
    }

    dispose()
  })

  bench('solid-js/store: 1000 updates with active effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ count: 0 })
      let effectRuns = 0

      createComputed(() => {
        const _ = store.count
        effectRuns++
      })

      for (let i = 0; i < 1000; i++) {
        setStore('count', i)
      }

      dispose()
    })
  })
})

describe('Deep Reactive Access (Correct)', () => {
  bench('@storable/core: deep reactive path', () => {
    const [store] = createStore({
      a: { b: { c: { d: { e: 42 } } } },
    })
    let total = 0

    const dispose = effect(() => {
      for (let i = 0; i < 1000; i++) {
        total += store.a.b.c.d.e
      }
    })

    dispose()
  })

  bench('solid-js/store: deep reactive path', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({
        a: { b: { c: { d: { e: 42 } } } },
      })
      let total = 0

      createComputed(() => {
        for (let i = 0; i < 1000; i++) {
          total += store.a.b.c.d.e
        }
      })

      dispose()
    })
  })
})

describe('Array Reactive Operations (Correct)', () => {
  bench('@storable/core: reactive array length tracking', () => {
    const [store] = createStore<{ items: number[] }>({ items: [] })
    let lengthChecks = 0

    const dispose = effect(() => {
      lengthChecks = store.items.length
    })

    for (let i = 0; i < 100; i++) {
      store.items.push(i)
    }

    dispose()
  })

  bench('solid-js/store: reactive array length tracking', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore<{ items: number[] }>({
        items: [],
      })
      let lengthChecks = 0

      createComputed(() => {
        lengthChecks = store.items.length
      })

      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }

      dispose()
    })
  })
})

describe('Non-Reactive Property Access (Correct)', () => {
  bench('@storable/core: 100k non-reactive reads', () => {
    const [store] = createStore({ value: 42 })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.value
    }
  })

  bench('solid-js/store: 100k non-reactive reads', () => {
    const [store] = createSolidStore({ value: 42 })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.value
    }
  })

  bench('plain object: 100k reads (baseline)', () => {
    const obj = { value: 42 }
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += obj.value
    }
  })
})

describe('Store Creation Performance (Correct)', () => {
  bench('@storable/core: create 1k stores', () => {
    const stores = []
    for (let i = 0; i < 1000; i++) {
      stores.push(
        createStore({
          id: i,
          name: `Item ${i}`,
          value: i * 2,
        })
      )
    }
  })

  bench('solid-js: create 1k stores', () => {
    createRoot(dispose => {
      const stores = []
      for (let i = 0; i < 1000; i++) {
        stores.push(
          createSolidStore({
            id: i,
            name: `Item ${i}`,
            value: i * 2,
          })
        )
      }
      dispose()
    })
  })
})

describe('Multiple Effect Dependencies (Correct)', () => {
  bench('@storable/core: 3 dependencies tracked', () => {
    const [store, setStore] = createStore({ a: 1, b: 2, c: 3 })
    let sum = 0

    const dispose = effect(() => {
      sum = store.a + store.b + store.c
    })

    setStore('a', 10)
    setStore('b', 20)
    setStore('c', 30)

    dispose()
  })

  bench('solid-js/store: 3 dependencies tracked', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ a: 1, b: 2, c: 3 })
      let sum = 0

      createComputed(() => {
        sum = store.a + store.b + store.c
      })

      setStore('a', 10)
      setStore('b', 20)
      setStore('c', 30)

      dispose()
    })
  })
})

describe('Batch Update Performance (Correct)', () => {
  bench('@storable/core: batch 10 property updates', () => {
    const [store, setStore] = createStore({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
      g: 0,
      h: 0,
      i: 0,
      j: 0,
    })
    let effectRuns = 0

    const dispose = effect(() => {
      const sum =
        store.a +
        store.b +
        store.c +
        store.d +
        store.e +
        store.f +
        store.g +
        store.h +
        store.i +
        store.j
      effectRuns++
    })

    setStore({
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

    dispose()
  })

  bench('solid-js/store: batch 10 property updates', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({
        a: 0,
        b: 0,
        c: 0,
        d: 0,
        e: 0,
        f: 0,
        g: 0,
        h: 0,
        i: 0,
        j: 0,
      })
      let effectRuns = 0

      createComputed(() => {
        const sum =
          store.a +
          store.b +
          store.c +
          store.d +
          store.e +
          store.f +
          store.g +
          store.h +
          store.i +
          store.j
        effectRuns++
      })

      setStore({
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

      dispose()
    })
  })
})
