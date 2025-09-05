import { bench, describe } from 'vitest'
import { createStore, update } from '../src'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import { createComputed, createRoot } from 'solid-js'

/**
 * Core benchmarks for comparing @storable/core with solid-js/store
 * These are the essential performance tests to run quickly during development
 */

// Helper to verify we're in a reactive context
function verifyReactiveContext(storeName: string) {
  let tracked = false
  const [testStore] = createStore({ value: 1 })

  const dispose = effect(() => {
    const _ = testStore.value
    tracked = true
  })

  testStore.value = 2
  dispose()

  if (!tracked) {
    throw new Error(
      `${storeName}: Reactive context verification failed - effects are not tracking properly`
    )
  }
}

// Verify reactive context before running benchmarks
verifyReactiveContext('@storable/core')

describe('Core: Store Creation', () => {
  bench('@storable/core: create 1000 stores', () => {
    const stores = []
    for (let i = 0; i < 1000; i++) {
      stores.push(
        createStore({
          id: i,
          name: `Item ${i}`,
          value: i * 2,
          nested: { count: i },
        })
      )
    }
  })

  bench('solid-js/store: create 1000 stores', () => {
    createRoot(dispose => {
      const stores = []
      for (let i = 0; i < 1000; i++) {
        stores.push(
          createSolidStore({
            id: i,
            name: `Item ${i}`,
            value: i * 2,
            nested: { count: i },
          })
        )
      }
      dispose()
    })
  })
})

describe('Core: Property Access', () => {
  bench('@storable/core: 100k non-reactive reads', () => {
    const [store] = createStore({
      user: { name: 'John', age: 30 },
    })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
    }
  })

  bench('solid-js/store: 100k non-reactive reads', () => {
    const [store] = createSolidStore({
      user: { name: 'John', age: 30 },
    })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
    }
  })

  bench('@storable/core: 10k reactive reads in effect', () => {
    const [store] = createStore({ value: 42 })
    let total = 0
    let effectRuns = 0

    const dispose = effect(() => {
      effectRuns++
      for (let i = 0; i < 10000; i++) {
        total += store.value
      }
    })

    // Verify the effect actually ran
    if (effectRuns === 0) {
      throw new Error(
        '@storable/core: Effect did not run during reactive reads benchmark'
      )
    }

    dispose()
  })

  bench('solid-js/store: 10k reactive reads in effect', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ value: 42 })
      let total = 0
      let effectRuns = 0

      createComputed(() => {
        effectRuns++
        for (let i = 0; i < 10000; i++) {
          total += store.value
        }
      })

      // Verify the effect actually ran
      if (effectRuns === 0) {
        throw new Error(
          'solid-js/store: Effect did not run during reactive reads benchmark'
        )
      }

      dispose()
    })
  })
})

describe('Core: Property Updates', () => {
  bench('@storable/core: 1000 updates with effect', () => {
    const [store, setStore] = createStore({ count: 0 })
    let effectRuns = 0

    const dispose = effect(() => {
      const _ = store.count
      effectRuns++
    })

    for (let i = 0; i < 1000; i++) {
      setStore('count', i)
    }

    // Verify the effect actually tracked and ran
    if (effectRuns === 0) {
      throw new Error('@storable/core: Effect did not track updates')
    }

    dispose()
  })

  bench('solid-js/store: 1000 updates with effect', () => {
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

      // Verify the effect actually tracked and ran
      if (effectRuns === 0) {
        throw new Error('solid-js/store: Effect did not track updates')
      }

      dispose()
    })
  })

  bench('@storable/core: batch update 10 properties', () => {
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
  })

  bench('solid-js/store: batch update 10 properties', () => {
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

  bench('@storable/core: direct property mutations', () => {
    const [store] = createStore({
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

    // Direct mutations (unique to @storable/core)
    store.a = 1
    store.b = 2
    store.c = 3
    store.d = 4
    store.e = 5
    store.f = 6
    store.g = 7
    store.h = 8
    store.i = 9
    store.j = 10
  })
})

describe('Core: Array Operations', () => {
  bench('@storable/core: push 500 items', () => {
    const [store] = createStore({ items: [] as number[] })
    for (let i = 0; i < 500; i++) {
      store.items.push(i)
    }
  })

  bench('solid-js/store: push 500 items', () => {
    const [store, setStore] = createSolidStore({ items: [] as number[] })
    for (let i = 0; i < 500; i++) {
      setStore('items', items => [...items, i])
    }
  })

  bench('@storable/core: splice 500 from 1000 items', () => {
    const [store] = createStore({
      items: Array.from({ length: 1000 }, (_, i) => i),
    })
    store.items.splice(0, 500)
  })

  bench('solid-js/store: remove 500 from 1000 items', () => {
    const [store, setStore] = createSolidStore({
      items: Array.from({ length: 1000 }, (_, i) => i),
    })
    setStore('items', items => items.slice(500))
  })

  bench('@storable/core: reactive array length tracking', () => {
    const [store] = createStore<{ items: number[] }>({ items: [] })
    let lengthChecks = 0
    let effectRuns = 0

    const dispose = effect(() => {
      effectRuns++
      lengthChecks = store.items.length
    })

    // Verify initial effect run
    if (effectRuns === 0) {
      throw new Error(
        '@storable/core: Array length effect did not run initially'
      )
    }

    for (let i = 0; i < 100; i++) {
      store.items.push(i)
    }

    // Verify effect tracked array mutations
    if (effectRuns === 1) {
      throw new Error(
        '@storable/core: Array mutations were not tracked by effect'
      )
    }

    dispose()
  })

  bench('solid-js/store: reactive array length tracking', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore<{ items: number[] }>({
        items: [],
      })
      let lengthChecks = 0
      let effectRuns = 0

      createComputed(() => {
        effectRuns++
        lengthChecks = store.items.length
      })

      // Verify initial effect run
      if (effectRuns === 0) {
        throw new Error(
          'solid-js/store: Array length effect did not run initially'
        )
      }

      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }

      // Verify effect tracked array mutations
      if (effectRuns === 1) {
        throw new Error(
          'solid-js/store: Array mutations were not tracked by effect'
        )
      }

      dispose()
    })
  })
})

describe('Core: Deep Nesting', () => {
  bench('@storable/core: deep reactive path (5 levels)', () => {
    const [store] = createStore({
      l1: { l2: { l3: { l4: { l5: { value: 42 } } } } },
    })
    let total = 0
    let effectRuns = 0

    const dispose = effect(() => {
      effectRuns++
      for (let i = 0; i < 1000; i++) {
        total += store.l1.l2.l3.l4.l5.value
      }
    })

    if (effectRuns === 0) {
      throw new Error('@storable/core: Deep nested effect did not run')
    }

    dispose()
  })

  bench('solid-js/store: deep reactive path (5 levels)', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({
        l1: { l2: { l3: { l4: { l5: { value: 42 } } } } },
      })
      let total = 0
      let effectRuns = 0

      createComputed(() => {
        effectRuns++
        for (let i = 0; i < 1000; i++) {
          total += store.l1.l2.l3.l4.l5.value
        }
      })

      if (effectRuns === 0) {
        throw new Error('solid-js/store: Deep nested effect did not run')
      }

      dispose()
    })
  })

  bench('@storable/core: deep update', () => {
    const [store, setStore] = createStore({
      l1: { l2: { l3: { l4: { l5: { value: 0 } } } } },
    })

    for (let i = 0; i < 100; i++) {
      setStore('l1', 'l2', 'l3', 'l4', 'l5', 'value', i)
    }
  })

  bench('solid-js/store: deep update', () => {
    const [store, setStore] = createSolidStore({
      l1: { l2: { l3: { l4: { l5: { value: 0 } } } } },
    })

    for (let i = 0; i < 100; i++) {
      setStore('l1', 'l2', 'l3', 'l4', 'l5', 'value', i)
    }
  })
})

describe('Core: Real-World Todo App', () => {
  interface Todo {
    id: number
    text: string
    completed: boolean
    tags: string[]
  }

  bench('@storable/core: todo operations', () => {
    const [store, setStore] = createStore<{
      todos: Todo[]
      filter: 'all' | 'active' | 'completed'
    }>({
      todos: [],
      filter: 'all',
    })

    // Add 50 todos
    for (let i = 0; i < 50; i++) {
      store.todos.push({
        id: i,
        text: `Todo ${i}`,
        completed: false,
        tags: ['work'],
      })
    }

    // Toggle half as completed
    for (let i = 0; i < 25; i++) {
      store.todos[i].completed = true
    }

    // Add tags to first 10
    for (let i = 0; i < 10; i++) {
      store.todos[i].tags.push('urgent')
    }

    // Filter active
    const active = store.todos.filter(t => !t.completed)

    // Update text of first 5
    for (let i = 0; i < 5; i++) {
      store.todos[i].text = `Updated: ${store.todos[i].text}`
    }

    // Remove completed todos using splice
    for (let i = store.todos.length - 1; i >= 0; i--) {
      if (store.todos[i].completed) {
        store.todos.splice(i, 1)
      }
    }
  })

  bench('solid-js/store: todo operations', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore<{
        todos: Todo[]
        filter: 'all' | 'active' | 'completed'
      }>({
        todos: [],
        filter: 'all',
      })

      // Add 50 todos
      for (let i = 0; i < 50; i++) {
        setStore('todos', todos => [
          ...todos,
          {
            id: i,
            text: `Todo ${i}`,
            completed: false,
            tags: ['work'],
          },
        ])
      }

      // Toggle half as completed
      for (let i = 0; i < 25; i++) {
        setStore('todos', i, 'completed', true)
      }

      // Add tags to first 10
      for (let i = 0; i < 10; i++) {
        setStore('todos', i, 'tags', tags => [...tags, 'urgent'])
      }

      // Filter active
      const active = store.todos.filter(t => !t.completed)

      // Update text of first 5
      for (let i = 0; i < 5; i++) {
        setStore('todos', i, 'text', text => `Updated: ${text}`)
      }

      // Remove completed todos
      setStore('todos', todos => todos.filter(t => !t.completed))

      dispose()
    })
  })
})

describe('Core: MongoDB Operators vs Direct Mutation', () => {
  bench('@storable/core: direct mutations', () => {
    const [state] = createStore({
      title: 'Original',
      viewCount: 100,
      tags: ['original'],
      metadata: { updated: false },
    })

    state.title = 'Updated'
    state.metadata.updated = true
    state.viewCount += 1
    state.tags.push('modified')
  })

  bench('@storable/core: MongoDB update operators', () => {
    const [state] = createStore({
      title: 'Original',
      viewCount: 100,
      tags: ['original'],
      metadata: { updated: false },
    })

    update(state, {
      $set: {
        title: 'Updated',
        'metadata.updated': true,
      },
      $inc: { viewCount: 1 },
      $push: { tags: 'modified' },
    })
  })

  bench('solid-js/store: equivalent updates', () => {
    const [state, setState] = createSolidStore({
      title: 'Original',
      viewCount: 100,
      tags: ['original'],
      metadata: { updated: false },
    })

    setState('title', 'Updated')
    setState('metadata', 'updated', true)
    setState('viewCount', v => v + 1)
    setState('tags', tags => [...tags, 'modified'])
  })
})

describe('Core: Effect Management', () => {
  bench('@storable/core: create and dispose 100 effects', () => {
    const [store] = createStore({ count: 0 })
    const disposers = []

    for (let i = 0; i < 100; i++) {
      disposers.push(
        effect(() => {
          const _ = store.count
        })
      )
    }

    for (const dispose of disposers) {
      dispose()
    }
  })

  bench('solid-js/store: create and dispose 100 effects', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ count: 0 })

      for (let i = 0; i < 100; i++) {
        createComputed(() => {
          const _ = store.count
        })
      }

      dispose()
    })
  })

  bench('@storable/core: 100 effects tracking 1 property', () => {
    const [store] = createStore({ value: 0 })
    const disposers: (() => void)[] = []

    for (let i = 0; i < 100; i++) {
      disposers.push(
        effect(() => {
          const _ = store.value
        })
      )
    }

    disposers.forEach(d => d())
  })

  bench('solid-js/store: 100 effects tracking 1 property', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ value: 0 })

      for (let i = 0; i < 100; i++) {
        createComputed(() => {
          const _ = store.value
        })
      }

      dispose()
    })
  })

  bench('@storable/core: 3 dependencies tracked', () => {
    const [store, setStore] = createStore({ a: 1, b: 2, c: 3 })
    let sum = 0
    let effectRuns = 0

    const dispose = effect(() => {
      effectRuns++
      sum = store.a + store.b + store.c
    })

    const initialRuns = effectRuns

    setStore('a', 10)
    setStore('b', 20)
    setStore('c', 30)

    // Verify effect ran for each update
    if (effectRuns === initialRuns) {
      throw new Error(
        '@storable/core: Effect did not track multiple dependencies'
      )
    }

    dispose()
  })

  bench('solid-js/store: 3 dependencies tracked', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ a: 1, b: 2, c: 3 })
      let sum = 0
      let effectRuns = 0

      createComputed(() => {
        effectRuns++
        sum = store.a + store.b + store.c
      })

      const initialRuns = effectRuns

      setStore('a', 10)
      setStore('b', 20)
      setStore('c', 30)

      // Verify effect ran for each update
      if (effectRuns === initialRuns) {
        throw new Error(
          'solid-js/store: Effect did not track multiple dependencies'
        )
      }

      dispose()
    })
  })
})

describe('Core: Complex Object Updates', () => {
  bench('@storable/core: update nested object array', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
      metadata: { updated: false },
    }))

    const [store] = createStore({ items: initialItems })

    // Update half the items
    for (let i = 0; i < 500; i++) {
      store.items[i].value = i * 3
      store.items[i].metadata.updated = true
    }
  })

  bench('solid-js/store: update nested object array', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
      metadata: { updated: false },
    }))

    const [store, setStore] = createSolidStore({ items: initialItems })

    // Update half the items
    for (let i = 0; i < 500; i++) {
      setStore('items', i, 'value', i * 3)
      setStore('items', i, 'metadata', 'updated', true)
    }
  })
})
