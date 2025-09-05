import { bench, describe } from 'vitest'
import { createStore, update } from '../src'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import { createComputed, createRoot } from 'solid-js'

/**
 * Core benchmarks for comparing @storable/core with solid-js/store.
 *
 * These benchmarks include reliability checks (assertions) to ensure they are
 * correctly measuring what they claim to be. A benchmark that isn't reliable
 * is useless. If an assertion fails, it means the underlying reactivity
 * is broken or the benchmark is no longer testing the intended behavior.
 */

// Helper to verify we're in a reactive context before running benchmarks
function verifyReactiveContext(storeName: string) {
  let tracked = false
  const [testStore, updateTestStore] = createStore({ value: 1 })

  const dispose = effect(() => {
    // Accessing the value should be tracked by the effect
    testStore.value
    tracked = true
  })

  // The effect should have run once immediately
  if (!tracked) {
    dispose()
    throw new Error(
      `${storeName}: Reactive context verification failed - effect did not run initially.`
    )
  }

  // Reset for the next check
  tracked = false
  // This update should trigger the effect again
  updateTestStore({ $set: { value: 2 } })

  if (!tracked) {
    dispose()
    throw new Error(
      `${storeName}: Reactive context verification failed - effect did not re-run on update.`
    )
  }

  dispose()
}

// Run the verification before any benchmarks to fail fast if reactivity is broken
verifyReactiveContext('@storable/core')

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
  const solidStore = createSolidStore({ user: { age: 30 } })[0]

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

describe('Core: Property Access: Reactive', () => {
  bench('@storable/core: 10k reactive reads in an effect', () => {
    const [store, setStore] = createStore({ value: 0 })
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      for (let i = 0; i < 10000; i++) {
        store.value
      }
    })
    if (effectRuns !== 1) throw new Error('Effect should run once initially.')
    setStore({ $set: { value: 1 } })
    if ((effectRuns as number) !== 2)
      throw new Error('Effect should re-run on update.')
    dispose()
  })

  bench('solid-js/store: 10k reactive reads in an effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ value: 0 })
      let effectRuns = 0
      createComputed(() => {
        effectRuns++
        for (let i = 0; i < 10000; i++) {
          store.value
        }
      })
      if (effectRuns !== 1) throw new Error('Effect should run once initially.')
      setStore('value', 1)
      if ((effectRuns as number) !== 2)
        throw new Error('Effect should re-run on update.')
      dispose()
    })
  })
})

describe('Core: Property Updates', () => {
  bench('@storable/core: 1000 updates triggering an effect', () => {
    const [store, setStore] = createStore({ count: 0 })
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      store.count
    })
    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i } })
    }
    // 1 initial run + 1000 updates
    if (effectRuns !== 1001)
      throw new Error(`Effect ran ${effectRuns} times, expected 1001.`)
    dispose()
  })

  bench('solid-js/store: 1000 updates triggering an effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ count: 0 })
      let effectRuns = 0
      createComputed(() => {
        effectRuns++
        store.count
      })
      for (let i = 0; i < 1000; i++) {
        setStore('count', i)
      }
      // 1 initial run + 1000 updates
      if (effectRuns !== 1001)
        throw new Error(`Effect ran ${effectRuns} times, expected 1001.`)
      dispose()
    })
  })
})

describe('Core: Batch Updates', () => {
  bench('@storable/core: batch update 10 properties with one effect', () => {
    const [store, setStore] = createStore({ a: 0, b: 0, c: 0 })
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      store.a, store.b, store.c
    })
    setStore({ $set: { a: 1, b: 2, c: 3 } })
    // 1 initial run + 1 for the batched update
    if (effectRuns !== 2)
      throw new Error(`Effect ran ${effectRuns} times, expected 2.`)
    dispose()
  })

  bench('solid-js/store: batch update 10 properties with one effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ a: 0, b: 0, c: 0 })
      let effectRuns = 0
      createComputed(() => {
        effectRuns++
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        store.a, store.b, store.c
      })
      setStore({ a: 1, b: 2, c: 3 })
      // 1 initial run + 1 for the batched update
      if (effectRuns !== 2)
        throw new Error(`Effect ran ${effectRuns} times, expected 2.`)
      dispose()
    })
  })
})

describe('Core: Array Operations: Reactive Length Tracking', () => {
  bench('@storable/core: 100 pushes tracked by length', () => {
    const [store, update] = createStore<{ items: number[] }>({ items: [] })
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      store.items.length
    })
    for (let i = 0; i < 100; i++) {
      update({ $push: { items: i } })
    }
    // 1 initial run + 100 for each push that changes the length
    if (effectRuns !== 101)
      throw new Error(`Effect ran ${effectRuns} times, expected 101.`)
    dispose()
  })

  bench('solid-js/store: 100 pushes tracked by length', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore<{ items: number[] }>({
        items: [],
      })
      let effectRuns = 0
      createComputed(() => {
        effectRuns++
        store.items.length
      })
      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }
      // 1 initial run + 100 updates
      if (effectRuns !== 101)
        throw new Error(`Effect ran ${effectRuns} times, expected 101.`)
      dispose()
    })
  })
})

describe('Core: Deep Update', () => {
  const getDeepState = () => ({ l1: { l2: { l3: { value: 0 } } } })

  bench('@storable/core: 100 deep updates with effect', () => {
    const [store, setStore] = createStore(getDeepState())
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      store.l1.l2.l3.value
    })
    for (let i = 0; i < 100; i++) {
      setStore({ $set: { 'l1.l2.l3.value': i } })
    }
    // 1 initial run + 100 updates
    if (effectRuns !== 101)
      throw new Error(`Effect ran ${effectRuns} times, expected 101.`)
    dispose()
  })

  bench('solid-js/store: 100 deep updates with effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore(getDeepState())
      let effectRuns = 0
      createComputed(() => {
        effectRuns++
        store.l1.l2.l3.value
      })
      for (let i = 0; i < 100; i++) {
        setStore('l1', 'l2', 'l3', 'value', i)
      }
      // 1 initial run + 100 updates
      if (effectRuns !== 101)
        throw new Error(`Effect ran ${effectRuns} times, expected 101.`)
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

  bench('@storable/core: reactive todo operations', () => {
    const [store, update] = createStore({ todos: createInitialTodos(50) })
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      // Track a derived value
      store.todos.filter(t => !t.completed).length
    })
    const initialRuns = effectRuns
    // Toggle all items
    for (let i = 0; i < 50; i++) {
      const todo = store.todos[i]
      if (todo) {
        update({ $set: { [`todos.${i}.completed`]: !todo.completed } })
      }
    }
    // Remove first 10
    update({ $set: { todos: store.todos.slice(10) } })
    // Check that effects ran multiple times
    if (effectRuns <= initialRuns + 1)
      throw new Error('Effects did not run sufficiently for todo operations.')
    dispose()
  })

  bench('solid-js/store: reactive todo operations', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({
        todos: createInitialTodos(50),
      })
      let effectRuns = 0
      createComputed(() => {
        effectRuns++
        store.todos.filter(t => !t.completed).length
      })
      const initialRuns = effectRuns
      // Toggle all items
      for (let i = 0; i < 50; i++) {
        setStore('todos', i, 'completed', c => !c)
      }
      // Remove first 10
      setStore('todos', todos => todos.slice(10))
      if (effectRuns <= initialRuns + 1)
        throw new Error('Effects did not run sufficiently for todo operations.')
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

  bench('@storable/core: individual updates with effect', () => {
    const [state] = createStore(getInitialState())
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      state.title, state.viewCount, state.tags.length, state.metadata.updated
    })
    update({ $set: { title: 'Updated' } })
    update({ $set: { 'metadata.updated': true } })
    update({ $inc: { viewCount: 1 } })
    update({ $push: { tags: 'modified' } })
    // Should not be batched, so 1 initial + 4 updates
    if (effectRuns !== 5)
      throw new Error(`Effect ran ${effectRuns} times, expected 5.`)
    dispose()
  })

  bench('@storable/core: MongoDB update operators with effect', () => {
    const [state, update] = createStore(getInitialState())
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns++
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      state.title, state.viewCount, state.tags.length, state.metadata.updated
    })
    update(state, {
      $set: { title: 'Updated', 'metadata.updated': true } as any,
      $inc: { viewCount: 1 },
      $push: { tags: 'modified' },
    })
    // update() is batched, so 1 initial + 1 batched update
    if (effectRuns !== 2)
      throw new Error(`Effect ran ${effectRuns} times, expected 2.`)
    dispose()
  })

  bench('solid-js/store: equivalent updates with effect', () => {
    createRoot(dispose => {
      const [state, setState] = createSolidStore(getInitialState())
      let effectRuns = 0
      createComputed(() => {
        effectRuns++
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state.title, state.viewCount, state.tags.length, state.metadata.updated
      })
      // Solid's setState is batched automatically in effects, but not here
      // so we expect multiple updates.
      setState('title', 'Updated')
      setState('metadata', 'updated', true)
      setState('viewCount', v => v + 1)
      setState('tags', tags => [...tags, 'modified'])
      if (effectRuns !== 5)
        throw new Error(`Effect ran ${effectRuns} times, expected 5.`)
      dispose()
    })
  })
})
