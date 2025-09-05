import { bench, describe } from 'vitest'
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
    let runs = 0
    const dispose = effect(() => {
      runs++
      for (let i = 0; i < 10000; i++) {
        store.value
      }
    })
    // Verify effect ran
    if (runs !== 1) throw new Error('Effect did not run')
    dispose()
  })

  bench('solid-js/store: create effect with 10k property reads', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ value: 0 })
      let runs = 0
      createEffect(() => {
        runs++
        for (let i = 0; i < 10000; i++) {
          store.value
        }
      })
      // Verify effect ran
      if (runs !== 1) throw new Error('Effect did not run')
      dispose()
    })
  })
})

describe('Core: Property Updates with Effects', () => {
  bench('@storable/core: 1000 sequential updates', () => {
    const [store, setStore] = createStore({ count: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.count
    })
    // Verify initial effect
    if (runs !== 1) throw new Error('Initial effect did not run')

    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i + 1 } })
    }
    dispose()
  })

  bench('solid-js/store: 1000 batched updates', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ count: 0 })
      let runs = 0
      createEffect(() => {
        runs++
        store.count
      })
      // Verify initial effect
      if (runs !== 1) throw new Error('Initial effect did not run')

      batch(() => {
        for (let i = 0; i < 1000; i++) {
          setStore('count', i + 1)
        }
      })
      // Verify batch worked (should only run once more)
      if (runs !== 2) throw new Error(`Expected 2 runs, got ${runs}`)
      dispose()
    })
  })
})

describe('Core: Batch Updates', () => {
  bench('@storable/core: batch update 3 properties', () => {
    const [store, setStore] = createStore({ a: 0, b: 0, c: 0 })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.a + store.b + store.c
    })
    if (runs !== 1) throw new Error('Effect did not run')

    setStore({ $set: { a: 1, b: 2, c: 3 } })
    dispose()
  })

  bench('solid-js/store: batch update 3 properties', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ a: 0, b: 0, c: 0 })
      let runs = 0
      createEffect(() => {
        runs++
        store.a + store.b + store.c
      })
      if (runs !== 1) throw new Error('Effect did not run')

      setStore({ a: 1, b: 2, c: 3 })
      // Verify synchronous update
      if (runs !== 2) throw new Error('Update did not trigger effect')
      dispose()
    })
  })
})

describe('Core: Array Operations', () => {
  bench('@storable/core: 100 array pushes', () => {
    const [store, update] = createStore<{ items: number[] }>({ items: [] })
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.items.length
    })
    if (runs !== 1) throw new Error('Effect did not run')

    for (let i = 0; i < 100; i++) {
      update({ $push: { items: i } })
    }
    dispose()
  })

  bench('solid-js/store: 100 array pushes', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore<{ items: number[] }>({
        items: [],
      })
      let runs = 0
      createEffect(() => {
        runs++
        store.items.length
      })
      if (runs !== 1) throw new Error('Effect did not run')

      batch(() => {
        for (let i = 0; i < 100; i++) {
          setStore('items', items => [...items, i])
        }
      })
      if (runs !== 2) throw new Error('Batch did not work')
      dispose()
    })
  })
})

describe('Core: Deep Updates', () => {
  const getDeepState = () => ({ l1: { l2: { l3: { value: 0 } } } })

  bench('@storable/core: 100 deep updates', () => {
    const [store, setStore] = createStore(getDeepState())
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.l1.l2.l3.value
    })
    if (runs !== 1) throw new Error('Effect did not run')

    for (let i = 0; i < 100; i++) {
      setStore({ $set: { 'l1.l2.l3.value': i + 1 } })
    }
    dispose()
  })

  bench('solid-js/store: 100 deep updates', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore(getDeepState())
      let runs = 0
      createEffect(() => {
        runs++
        store.l1.l2.l3.value
      })
      if (runs !== 1) throw new Error('Effect did not run')

      batch(() => {
        for (let i = 0; i < 100; i++) {
          setStore('l1', 'l2', 'l3', 'value', i + 1)
        }
      })
      if (runs !== 2) throw new Error('Batch did not work')
      dispose()
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
    let runs = 0
    const dispose = effect(() => {
      runs++
      store.todos.filter(t => !t.completed).length
    })
    if (runs !== 1) throw new Error('Effect did not run')

    for (let i = 0; i < 50; i++) {
      update({ $set: { [`todos.${i}.completed`]: !store.todos[i].completed } })
    }
    dispose()
  })

  bench('solid-js/store: toggle 50 todos', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({
        todos: createInitialTodos(50),
      })
      let runs = 0
      createEffect(() => {
        runs++
        store.todos.filter((t: Todo) => !t.completed).length
      })
      if (runs !== 1) throw new Error('Effect did not run')

      batch(() => {
        for (let i = 0; i < 50; i++) {
          setStore('todos', i, 'completed', c => !c)
        }
      })
      if (runs !== 2) throw new Error('Batch did not work')
      dispose()
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
    let runs = 0
    const dispose = effect(() => {
      runs++
      state.title + state.viewCount + state.tags.length + state.metadata.updated
    })
    if (runs !== 1) throw new Error('Effect did not run')

    update({ $set: { title: 'Updated' } })
    update({ $set: { 'metadata.updated': true } })
    update({ $inc: { viewCount: 1 } })
    update({ $push: { tags: 'modified' } })
    dispose()
  })

  bench('@storable/core: MongoDB batch operators', () => {
    const [state, update] = createStore(getInitialState())
    let runs = 0
    const dispose = effect(() => {
      runs++
      state.title + state.viewCount + state.tags.length + state.metadata.updated
    })
    if (runs !== 1) throw new Error('Effect did not run')

    update({
      $set: { title: 'Updated', 'metadata.updated': true },
      $inc: { viewCount: 1 },
      $push: { tags: 'modified' },
    })
    dispose()
  })

  bench('solid-js/store: equivalent updates', () => {
    createRoot(dispose => {
      const [state, setState] = createSolidStore(getInitialState())
      let runs = 0
      createEffect(() => {
        runs++
        state.title +
          state.viewCount +
          state.tags.length +
          state.metadata.updated
      })
      if (runs !== 1) throw new Error('Effect did not run')

      batch(() => {
        setState('title', 'Updated')
        setState('metadata', 'updated', true)
        setState('viewCount', v => v + 1)
        setState('tags', tags => [...tags, 'modified'])
      })
      if (runs !== 2) throw new Error('Batch did not work')
      dispose()
    })
  })
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
      let initialRuns = 0
      for (let i = 0; i < 10; i++) {
        disposers.push(
          effect(() => {
            initialRuns++
            store[`prop${i}`].nested
          })
        )
      }
      if (initialRuns !== 10) throw new Error('Not all effects ran')

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
        let initialRuns = 0
        let updateRuns = 0
        for (let i = 0; i < 10; i++) {
          createEffect(() => {
            if (initialRuns < 10) initialRuns++
            else updateRuns++
            store[`prop${i}`].nested
          })
        }
        if (initialRuns !== 10) throw new Error('Not all effects ran')

        // Update only one property - should trigger only one effect
        setStore('prop5', 'nested', 999)

        // Verify granular reactivity
        if (updateRuns !== 1)
          throw new Error(`Expected 1 update, got ${updateRuns}`)

        dispose()
      })
    }
  )
})

describe('Core: Effect Tracking Performance', () => {
  bench(
    '@storable/core: create store with 100 properties and track one',
    () => {
      const data: any = {}
      for (let i = 0; i < 100; i++) {
        data[`prop${i}`] = i
      }
      const [store, setStore] = createStore(data)
      let runs = 0
      const dispose = effect(() => {
        runs++
        store.prop50
      })
      if (runs !== 1) throw new Error('Effect did not run')

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
        let runs = 0
        createEffect(() => {
          runs++
          store.prop50
        })
        if (runs !== 1) throw new Error('Effect did not run')

        setStore('prop50', 999)
        // Verify effect ran
        if (runs !== 2) throw new Error('Update did not trigger effect')
        dispose()
      })
    }
  )
})
