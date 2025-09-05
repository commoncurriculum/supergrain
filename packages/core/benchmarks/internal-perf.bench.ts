import { bench, describe } from 'vitest'
import { createStore } from '../src/store'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'
import { effect } from 'alien-signals'

describe('Internal Performance: Store Characteristics', () => {
  bench(
    '@storable/core: signal creation overhead (first reactive access)',
    () => {
      const [store] = createStore({
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
      let total = 0
      const dispose = effect(() => {
        // First access creates signals
        total =
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
      })
      dispose()
    }
  )

  bench(
    '@storable/core: cached signal access (subsequent reactive access)',
    () => {
      const [store] = createStore({
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

      // Create signals first
      const initDispose = effect(() => {
        const _ =
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
      })
      initDispose()

      // Now measure subsequent access
      let total = 0
      const dispose = effect(() => {
        total =
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
      })
      dispose()
    }
  )
})

describe('Internal Performance: Proxy Depth Impact', () => {
  bench('@storable/core: shallow proxy access (depth 1)', () => {
    const [store] = createStore({ value: 42 })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.value
    }
  })

  bench('@storable/core: nested proxy access (depth 3)', () => {
    const [store] = createStore({
      level1: { level2: { level3: { value: 42 } } },
    })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.level1.level2.level3.value
    }
  })

  bench('@storable/core: deep proxy access (depth 5)', () => {
    const [store] = createStore({
      level1: {
        level2: {
          level3: {
            level4: {
              level5: { value: 42 },
            },
          },
        },
      },
    })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.level1.level2.level3.level4.level5.value
    }
  })
})

describe('Internal Performance: Array Method Efficiency', () => {
  bench('@storable/core: array push with tracking', () => {
    const [store] = createStore<{ items: number[] }>({ items: [] })
    let effectRuns = 0

    const dispose = effect(() => {
      const _ = store.items.length
      effectRuns++
    })

    for (let i = 0; i < 100; i++) {
      store.items.push(i)
    }

    dispose()
  })

  bench('@storable/core: array splice with tracking', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })
    let effectRuns = 0

    const dispose = effect(() => {
      const _ = store.items.length
      effectRuns++
    })

    for (let i = 0; i < 50; i++) {
      store.items.splice(i, 1)
    }

    dispose()
  })

  bench('@storable/core: array map (non-mutating)', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 10; i++) {
      const mapped = store.items.map(x => x * 2)
    }
  })

  bench('@storable/core: array filter (non-mutating)', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 10; i++) {
      const filtered = store.items.filter(x => x % 2 === 0)
    }
  })
})

describe('Internal Performance: Batch Update Patterns', () => {
  bench('@storable/core: single property updates (100x)', () => {
    const [store, setStore] = createStore({ count: 0 })
    let effectRuns = 0

    const dispose = effect(() => {
      const _ = store.count
      effectRuns++
    })

    for (let i = 0; i < 100; i++) {
      setStore('count', i)
    }

    dispose()
  })

  bench('@storable/core: multi-property batch update', () => {
    const obj: any = {}
    for (let i = 0; i < 100; i++) {
      obj[`prop${i}`] = 0
    }
    const [store, setStore] = createStore(obj)
    let effectRuns = 0

    const dispose = effect(() => {
      let sum = 0
      for (let i = 0; i < 100; i++) {
        sum += store[`prop${i}`]
      }
      effectRuns++
    })

    const updates: any = {}
    for (let i = 0; i < 100; i++) {
      updates[`prop${i}`] = i
    }
    setStore(updates)

    dispose()
  })

  bench('@storable/core: nested property updates', () => {
    const [store, setStore] = createStore({
      user: {
        profile: { name: '', age: 0 },
        settings: { theme: 'dark', notifications: true },
      },
    })

    setStore('user', 'profile', 'name', 'John')
    setStore('user', 'profile', 'age', 30)
    setStore('user', 'settings', 'theme', 'light')
    setStore('user', 'settings', 'notifications', false)
  })
})

describe('Internal Performance: Memory and GC Patterns', () => {
  bench('@storable/core: create 1000 small stores', () => {
    const stores = []
    for (let i = 0; i < 1000; i++) {
      stores.push(createStore({ id: i, name: `Item ${i}` }))
    }
  })

  bench('@storable/core: create 100 large stores', () => {
    const stores = []
    for (let i = 0; i < 100; i++) {
      const data: any = {}
      for (let j = 0; j < 100; j++) {
        data[`prop${j}`] = {
          id: j,
          value: j * 2,
          nested: { a: j, b: j * 3 },
        }
      }
      stores.push(createStore(data))
    }
  })

  bench('@storable/core: create and dispose 1000 effects', () => {
    const [store] = createStore({ count: 0 })
    const disposers = []

    for (let i = 0; i < 1000; i++) {
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

  bench('@storable/core: proxy cache effectiveness', () => {
    const [store] = createStore({
      nested: { deeply: { nested: { value: 42 } } },
    })

    // Access the same path repeatedly (should use cached proxies)
    let total = 0
    for (let i = 0; i < 1000; i++) {
      const nested = store.nested
      const deeply = nested.deeply
      const innerNested = deeply.nested
      total += innerNested.value
    }
  })
})

describe('Internal Performance: Real-World Use Cases', () => {
  bench('@storable/core: todo list management', () => {
    interface Todo {
      id: number
      text: string
      completed: boolean
      tags: string[]
    }

    const [store, setStore] = createStore<{
      todos: Todo[]
      filter: 'all' | 'active' | 'completed'
    }>({
      todos: [],
      filter: 'all',
    })

    // Add todos
    for (let i = 0; i < 30; i++) {
      store.todos.push({
        id: i,
        text: `Todo ${i}`,
        completed: false,
        tags: ['work', 'important'],
      })
    }

    // Complete some
    for (let i = 0; i < 15; i++) {
      store.todos[i].completed = true
    }

    // Add tags
    for (let i = 0; i < 10; i++) {
      store.todos[i].tags.push('urgent')
    }

    // Filter
    setStore('filter', 'active')
    const active = store.todos.filter(t => !t.completed)

    // Remove completed
    setStore('todos', todos => todos.filter(t => !t.completed))
  })

  bench('@storable/core: form state management', () => {
    const [form, setForm] = createStore({
      fields: {
        firstName: { value: '', error: '', touched: false },
        lastName: { value: '', error: '', touched: false },
        email: { value: '', error: '', touched: false },
        phone: { value: '', error: '', touched: false },
        address: {
          street: { value: '', error: '', touched: false },
          city: { value: '', error: '', touched: false },
          state: { value: '', error: '', touched: false },
          zip: { value: '', error: '', touched: false },
        },
      },
      isValid: false,
      isSubmitting: false,
    })

    // Simulate user input
    setForm('fields', 'firstName', 'value', 'John')
    setForm('fields', 'firstName', 'touched', true)

    setForm('fields', 'lastName', 'value', 'Doe')
    setForm('fields', 'lastName', 'touched', true)

    setForm('fields', 'email', 'value', 'john@example.com')
    setForm('fields', 'email', 'touched', true)

    // Validate
    if (!form.fields.email.value.includes('@')) {
      setForm('fields', 'email', 'error', 'Invalid email')
    }

    // Address fields
    setForm('fields', 'address', 'street', 'value', '123 Main St')
    setForm('fields', 'address', 'city', 'value', 'Seattle')
    setForm('fields', 'address', 'state', 'value', 'WA')
    setForm('fields', 'address', 'zip', 'value', '98101')

    setForm('isValid', true)
  })

  bench('@storable/core: data grid operations', () => {
    interface Row {
      id: number
      name: string
      value: number
      selected: boolean
    }

    const [grid, setGrid] = createStore<{
      rows: Row[]
      sortBy: string | null
      sortOrder: 'asc' | 'desc'
      selectedIds: Set<number>
    }>({
      rows: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random() * 1000,
        selected: false,
      })),
      sortBy: null,
      sortOrder: 'asc',
      selectedIds: new Set(),
    })

    // Select some rows
    for (let i = 0; i < 20; i++) {
      grid.rows[i].selected = true
    }

    // Sort simulation
    setGrid('sortBy', 'value')
    setGrid('sortOrder', 'desc')

    // Bulk update values
    for (let i = 0; i < 50; i++) {
      grid.rows[i].value = grid.rows[i].value * 1.1
    }

    // Clear selection
    grid.rows.forEach(row => {
      if (row.selected) row.selected = false
    })
  })
})
