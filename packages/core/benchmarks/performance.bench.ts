import { bench, describe } from 'vitest'
import { createStore as createSolidStore } from 'solid-js/store'
import { createComputed, createRoot } from 'solid-js'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'

describe('Critical Performance: Reactive Property Reads', () => {
  bench('@storable/core: 10k reactive reads in single effect', () => {
    const [store] = createStore({ user: { name: 'John', age: 30 } })
    let total = 0
    const dispose = effect(() => {
      for (let i = 0; i < 10000; i++) {
        total += store.user.age
      }
    })
    dispose()
  })

  bench('solid-js: 10k reactive reads in single effect', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ user: { name: 'John', age: 30 } })
      let total = 0
      createComputed(() => {
        for (let i = 0; i < 10000; i++) {
          total += store.user.age
        }
      })
      dispose()
    })
  })
})

describe('Critical Performance: Non-Reactive Property Reads', () => {
  bench('@storable/core: 100k non-reactive reads', () => {
    const [store] = createStore({
      user: { name: 'John', age: 30, email: 'john@example.com' },
    })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
    }
  })

  bench('solid-js: 100k non-reactive reads', () => {
    const [store] = createSolidStore({
      user: { name: 'John', age: 30, email: 'john@example.com' },
    })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
    }
  })

  bench('plain object: 100k reads (baseline)', () => {
    const obj = {
      user: { name: 'John', age: 30, email: 'john@example.com' },
    }
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += obj.user.age
    }
  })
})

describe('Critical Performance: Property Updates', () => {
  bench('@storable/core: 1k updates with effect', () => {
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

  bench('solid-js: 1k updates with effect', () => {
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

describe('Critical Performance: Array Operations', () => {
  bench('@storable/core: splice 500 items', () => {
    const [store] = createStore({
      items: Array.from({ length: 1000 }, (_, i) => i),
    })

    for (let i = 0; i < 500; i++) {
      store.items.splice(0, 1)
    }
  })

  bench('solid-js: remove 500 items', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({
        items: Array.from({ length: 1000 }, (_, i) => i),
      })

      for (let i = 0; i < 500; i++) {
        setStore('items', items => items.slice(1))
      }

      dispose()
    })
  })

  bench('plain array: splice 500 items (baseline)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i)

    for (let i = 0; i < 500; i++) {
      items.splice(0, 1)
    }
  })
})

describe('Critical Performance: Deep Object Access', () => {
  bench('@storable/core: 10k deep reads', () => {
    const [store] = createStore({
      a: { b: { c: { d: { e: { value: 42 } } } } },
    })
    let total = 0

    for (let i = 0; i < 10000; i++) {
      total += store.a.b.c.d.e.value
    }
  })

  bench('solid-js: 10k deep reads', () => {
    const [store] = createSolidStore({
      a: { b: { c: { d: { e: { value: 42 } } } } },
    })
    let total = 0

    for (let i = 0; i < 10000; i++) {
      total += store.a.b.c.d.e.value
    }
  })

  bench('plain object: 10k deep reads (baseline)', () => {
    const obj = {
      a: { b: { c: { d: { e: { value: 42 } } } } },
    }
    let total = 0

    for (let i = 0; i < 10000; i++) {
      total += obj.a.b.c.d.e.value
    }
  })
})

describe('Critical Performance: Store Creation', () => {
  bench('@storable/core: create 1k stores', () => {
    const stores = []
    for (let i = 0; i < 1000; i++) {
      stores.push(createStore({ id: i, value: i * 2 }))
    }
  })

  bench('solid-js: create 1k stores', () => {
    createRoot(dispose => {
      const stores = []
      for (let i = 0; i < 1000; i++) {
        stores.push(createSolidStore({ id: i, value: i * 2 }))
      }
      dispose()
    })
  })
})

describe('Critical Performance: Batch Updates', () => {
  bench('@storable/core: batch 100 property updates', () => {
    const obj: any = {}
    for (let i = 0; i < 100; i++) {
      obj[`prop${i}`] = 0
    }
    const [store, setStore] = createStore(obj)

    const updates: any = {}
    for (let i = 0; i < 100; i++) {
      updates[`prop${i}`] = i
    }
    setStore(updates)
  })

  bench('solid-js: batch 100 property updates', () => {
    createRoot(dispose => {
      const obj: any = {}
      for (let i = 0; i < 100; i++) {
        obj[`prop${i}`] = 0
      }
      const [store, setStore] = createSolidStore(obj)

      const updates: any = {}
      for (let i = 0; i < 100; i++) {
        updates[`prop${i}`] = i
      }
      setStore(updates)

      dispose()
    })
  })
})

describe('Critical Performance: Memory Patterns', () => {
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

  bench('solid-js: create and dispose 100 effects', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ count: 0 })
      const disposers: Array<() => void> = []

      for (let i = 0; i < 100; i++) {
        createComputed(() => {
          const _ = store.count
        })
      }

      dispose()
    })
  })
})

describe('Critical Performance: Real-World Todo App', () => {
  interface Todo {
    id: number
    text: string
    completed: boolean
  }

  bench('@storable/core: todo app operations', () => {
    const [store, setStore] = createStore<{ todos: Todo[] }>({ todos: [] })

    // Add 50 todos
    for (let i = 0; i < 50; i++) {
      store.todos.push({
        id: i,
        text: `Todo ${i}`,
        completed: false,
      })
    }

    // Toggle half as completed
    for (let i = 0; i < 25; i++) {
      store.todos[i].completed = true
    }

    // Filter completed
    const active = store.todos.filter(t => !t.completed)

    // Update text of first 10
    for (let i = 0; i < 10; i++) {
      if (store.todos[i]) {
        store.todos[i].text = `Updated: ${store.todos[i].text}`
      }
    }
  })

  bench('solid-js: todo app operations', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore<{ todos: Todo[] }>({
        todos: [],
      })

      // Add 50 todos
      for (let i = 0; i < 50; i++) {
        setStore('todos', todos => [
          ...todos,
          {
            id: i,
            text: `Todo ${i}`,
            completed: false,
          },
        ])
      }

      // Toggle half as completed
      for (let i = 0; i < 25; i++) {
        setStore('todos', i, 'completed', true)
      }

      // Filter completed (just access, don't mutate)
      const active = store.todos.filter(t => !t.completed)

      // Update text of first 10
      for (let i = 0; i < 10; i++) {
        setStore('todos', i, 'text', (text: string) => `Updated: ${text}`)
      }

      dispose()
    })
  })
})
