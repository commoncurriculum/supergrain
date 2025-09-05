import { bench, describe, afterAll } from 'vitest'
import { createStore } from '../src'
import { effect } from 'alien-signals'
import { createStore as createSolidStore, reconcile } from 'solid-js/store'
import { createRoot, createEffect, batch } from 'solid-js'

/**
 * Core benchmarks for comparing @storable/core with solid-js/store.
 *
 * These benchmarks include reliability checks (assertions) to ensure they are
 * correctly measuring what they claim to be. A benchmark that isn't reliable
 * is useless. If an assertion fails, it means the underlying reactivity
 * is broken or the benchmark is no longer testing the intended behavior.
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

describe('Core: Property Access: Non-reactive', () => {
  const storableStore = createStore({ user: { age: 30 } })[0]
  let solidStore: any
  createRoot(() => {
    solidStore = createSolidStore({ user: { age: 30 } })[0]
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
    const dispose = effect(() => {
      for (let i = 0; i < 10000; i++) {
        store.value
      }
    })
    dispose()
  })

  bench('solid-js/store: create effect with 10k property reads', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ value: 0 })
      createEffect(() => {
        for (let i = 0; i < 10000; i++) {
          store.value
        }
      })
      dispose()
    })
  })
})

describe('Core: Reactive Updates', () => {
  // Pre-create stores outside benchmarks to measure just the update cost
  const [storableStore, setStorableStore] = createStore({ counter: 0 })
  let storableCounter = 0
  effect(() => {
    storableCounter = storableStore.counter
  })

  let solidStore: any, setSolidStore: any
  let solidCounter = 0
  createRoot(() => {
    ;[solidStore, setSolidStore] = createSolidStore({ counter: 0 })
    createEffect(() => {
      solidCounter = solidStore.counter
    })
  })

  bench('@storable/core: trigger reactive update', () => {
    setStorableStore({ $set: { counter: Math.random() } })
  })

  bench('solid-js/store: trigger reactive update', () => {
    setSolidStore('counter', Math.random())
  })
})

describe('Core: Property Updates', () => {
  bench('@storable/core: 1000 sequential updates', () => {
    const [store, setStore] = createStore({ count: 0 })
    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i + 1 } })
    }
  })

  bench('solid-js/store: 1000 batched updates', () => {
    let store: any, setStore: any
    createRoot(() => {
      ;[store, setStore] = createSolidStore({ count: 0 })
    })
    batch(() => {
      for (let i = 0; i < 1000; i++) {
        setStore('count', i + 1)
      }
    })
  })
})

describe('Core: Batch Updates', () => {
  bench('@storable/core: batch update 3 properties', () => {
    const [store, setStore] = createStore({ a: 0, b: 0, c: 0 })
    setStore({ $set: { a: 1, b: 2, c: 3 } })
  })

  bench('solid-js/store: batch update 3 properties', () => {
    let store: any, setStore: any
    createRoot(() => {
      ;[store, setStore] = createSolidStore({ a: 0, b: 0, c: 0 })
    })
    setStore({ a: 1, b: 2, c: 3 })
  })
})

describe('Core: Array Operations', () => {
  bench('@storable/core: 100 array pushes', () => {
    const [store, update] = createStore<{ items: number[] }>({ items: [] })
    for (let i = 0; i < 100; i++) {
      update({ $push: { items: i } })
    }
  })

  bench('solid-js/store: 100 array pushes', () => {
    let store: any, setStore: any
    createRoot(() => {
      ;[store, setStore] = createSolidStore<{ items: number[] }>({
        items: [],
      })
    })
    batch(() => {
      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }
    })
  })
})

describe('Core: Deep Updates', () => {
  const getDeepState = () => ({ l1: { l2: { l3: { value: 0 } } } })

  bench('@storable/core: 100 deep updates', () => {
    const [store, setStore] = createStore(getDeepState())
    for (let i = 0; i < 100; i++) {
      setStore({ $set: { 'l1.l2.l3.value': i + 1 } })
    }
  })

  bench('solid-js/store: 100 deep updates', () => {
    let store: any, setStore: any
    createRoot(() => {
      ;[store, setStore] = createSolidStore(getDeepState())
    })
    batch(() => {
      for (let i = 0; i < 100; i++) {
        setStore('l1', 'l2', 'l3', 'value', i + 1)
      }
    })
  })
})

describe('Core: Real-World Todo App Simulation', () => {
  interface Todo {
    id: number
    text: string
    completed: boolean
  }
  const createInitialTodos = (num: number): Todo[] =>
    Array.from({ length: num }, (_, i) => ({
      id: i,
      text: `Todo ${i}`,
      completed: i % 2 === 0,
    }))

  bench('@storable/core: toggle 50 todos', () => {
    const [store, update] = createStore({ todos: createInitialTodos(50) })
    for (let i = 0; i < 50; i++) {
      update({ $set: { [`todos.${i}.completed`]: !store.todos[i].completed } })
    }
  })

  bench('solid-js/store: toggle 50 todos', () => {
    let store: any, setStore: any
    createRoot(() => {
      ;[store, setStore] = createSolidStore({
        todos: createInitialTodos(50),
      })
    })
    batch(() => {
      for (let i = 0; i < 50; i++) {
        setStore('todos', i, 'completed', c => !c)
      }
    })
  })
})

describe('Core: MongoDB Operators vs Direct Mutation', () => {
  const getInitialState = () => ({
    title: 'Original',
    viewCount: 100,
    tags: ['original'],
    metadata: { updated: false },
  })

  bench('@storable/core: individual updates', () => {
    const [state, update] = createStore(getInitialState())
    update({ $set: { title: 'Updated' } })
    update({ $set: { 'metadata.updated': true } })
    update({ $inc: { viewCount: 1 } })
    update({ $push: { tags: 'modified' } })
  })

  bench('@storable/core: MongoDB batch operators', () => {
    const [state, update] = createStore(getInitialState())
    update({
      $set: { title: 'Updated', 'metadata.updated': true },
      $inc: { viewCount: 1 },
      $push: { tags: 'modified' },
    })
  })

  bench('solid-js/store: equivalent updates', () => {
    let state: any, setState: any
    createRoot(() => {
      ;[state, setState] = createSolidStore(getInitialState())
    })
    batch(() => {
      setState('title', 'Updated')
      setState('metadata', 'updated', true)
      setState('viewCount', v => v + 1)
      setState('tags', tags => [...tags, 'modified'])
    })
  })
})

describe('Core: Effect Tracking Performance', () => {
  // Test how efficiently effects track dependencies
  bench(
    '@storable/core: create store with 100 properties and track one',
    () => {
      const data: any = {}
      for (let i = 0; i < 100; i++) {
        data[`prop${i}`] = i
      }
      const [store, setStore] = createStore(data)
      let value = 0
      const dispose = effect(() => {
        value = store.prop50
      })
      setStore({ $set: { prop50: 999 } })
      dispose()
    }
  )

  bench(
    'solid-js/store: create store with 100 properties and track one',
    () => {
      createRoot(dispose => {
        const data: any = {}
        for (let i = 0; i < 100; i++) {
          data[`prop${i}`] = i
        }
        const [store, setStore] = createSolidStore(data)
        let value = 0
        createEffect(() => {
          value = store.prop50
        })
        setStore('prop50', 999)
        dispose()
      })
    }
  )
})

describe('Core: Granular Reactivity', () => {
  bench(
    '@storable/core: update one property in object with 10 properties',
    () => {
      const data: any = {}
      for (let i = 0; i < 10; i++) {
        data[`prop${i}`] = { nested: i }
      }
      const [store, setStore] = createStore(data)

      // Create 10 effects, each tracking one property
      const disposers: (() => void)[] = []
      for (let i = 0; i < 10; i++) {
        disposers.push(
          effect(() => {
            store[`prop${i}`].nested
          })
        )
      }

      // Update only one property
      setStore({ $set: { 'prop5.nested': 999 } })

      // Cleanup
      disposers.forEach(d => d())
    }
  )

  bench(
    'solid-js/store: update one property in object with 10 properties',
    () => {
      createRoot(dispose => {
        const data: any = {}
        for (let i = 0; i < 10; i++) {
          data[`prop${i}`] = { nested: i }
        }
        const [store, setStore] = createSolidStore(data)

        // Create 10 effects, each tracking one property
        for (let i = 0; i < 10; i++) {
          createEffect(() => {
            store[`prop${i}`].nested
          })
        }

        // Update only one property
        setStore('prop5', 'nested', 999)

        dispose()
      })
    }
  )
})
