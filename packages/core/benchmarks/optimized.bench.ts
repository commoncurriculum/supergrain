import { bench, describe } from 'vitest'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'

interface Entity {
  id: number
  name: string
  email: string
  age: number
}

describe('Optimized Proxy: creation', () => {
  bench('@storable/core: create 1,000 proxies', () => {
    const entities: Entity[] = []
    for (let i = 0; i < 1000; i++) {
      entities.push({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        age: 20 + (i % 50),
      })
    }

    entities.forEach(entity => {
      createStore(entity)
    })
  })

  bench('solid-js: create 1,000 stores', () => {
    const entities: Entity[] = []
    for (let i = 0; i < 1000; i++) {
      entities.push({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        age: 20 + (i % 50),
      })
    }

    entities.forEach(entity => {
      createSolidStore(entity)
    })
  })
})

describe('Optimized Proxy: property access', () => {
  bench('@storable/core: 10,000 reads', () => {
    const [user] = createStore<Entity>({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
    })

    let sum = 0
    for (let i = 0; i < 10000; i++) {
      sum += user.age
    }
  })

  bench('solid-js: 10,000 reads', () => {
    const [user] = createSolidStore<Entity>({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
    })

    let sum = 0
    for (let i = 0; i < 10000; i++) {
      sum += user.age
    }
  })

  bench('plain object: 10,000 reads (baseline)', () => {
    const user: Entity = {
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
    }

    let sum = 0
    for (let i = 0; i < 10000; i++) {
      sum += user.age
    }
  })
})

describe('Optimized Proxy: reactive property access', () => {
  bench('@storable/core: 10,000 reactive reads', () => {
    const [user] = createStore<Entity>({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
    })

    let sum = 0
    const dispose = effect(() => {
      for (let i = 0; i < 10000; i++) {
        sum += user.age
      }
    })
    dispose()
  })

  bench('solid-js: 10,000 reactive reads', () => {
    createRoot(dispose => {
      const [user] = createSolidStore<Entity>({
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
      })

      let sum = 0
      createSolidEffect(() => {
        for (let i = 0; i < 10000; i++) {
          sum += user.age
        }
      })

      dispose()
    })
  })
})

describe('Optimized Proxy: property mutation', () => {
  bench('@storable/core: 1,000 updates', () => {
    const [store, setStore] = createStore<{ user: { name: string } }>({
      user: { name: 'John Doe' },
    })

    for (let i = 0; i < 1000; i++) {
      setStore('user', 'name', `User ${i}`)
    }
  })

  bench('solid-js: 1,000 updates', () => {
    const [store, setStore] = createSolidStore<{ user: { name: string } }>({
      user: { name: 'John Doe' },
    })

    for (let i = 0; i < 1000; i++) {
      setStore('user', 'name', `User ${i}`)
    }
  })
})

describe('Optimized Proxy: array operations', () => {
  bench('@storable/core: push 500 items', () => {
    const [store] = createStore({ items: [] as number[] })

    for (let i = 0; i < 500; i++) {
      store.items.push(i)
    }
  })

  bench('solid-js: push 500 items', () => {
    const [store, setStore] = createSolidStore({ items: [] as number[] })

    for (let i = 0; i < 500; i++) {
      setStore('items', items => [...items, i])
    }
  })

  bench('plain array: push 500 items (baseline)', () => {
    const store = { items: [] as number[] }

    for (let i = 0; i < 500; i++) {
      store.items.push(i)
    }
  })
})

describe('Optimized Proxy: batch updates', () => {
  bench('@storable/core: batch update 10 properties', () => {
    const [store] = createStore({
      a: 0, b: 0, c: 0, d: 0, e: 0,
      f: 0, g: 0, h: 0, i: 0, j: 0,
    })

    // Updates are automatically batched
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

  bench('solid-js: batch update 10 properties', () => {
    const [store, setStore] = createSolidStore({
      a: 0, b: 0, c: 0, d: 0, e: 0,
      f: 0, g: 0, h: 0, i: 0, j: 0,
    })

    // Use batch for solid
    setStore(s => ({
      a: 1, b: 2, c: 3, d: 4, e: 5,
      f: 6, g: 7, h: 8, i: 9, j: 10,
    }))
  })
})

describe('Optimized Proxy: effect tracking', () => {
  bench('@storable/core: 100 effects tracking 1 property', () => {
    const [store] = createStore({ value: 0 })

    const disposers: (() => void)[] = []
    for (let i = 0; i < 100; i++) {
      disposers.push(effect(() => {
        const _ = store.value
      }))
    }

    disposers.forEach(d => d())
  })

  bench('solid-js: 100 effects tracking 1 property', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ value: 0 })

      for (let i = 0; i < 100; i++) {
        createSolidEffect(() => {
          const _ = store.value
        })
      }

      dispose()
    })
  })
})

describe('Array update patterns', () => {
  bench('@storable/core: splice 500 from 1000 items', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initialItems })

    store.items.splice(0, 500)
  })

  bench('solid-js: remove 500 from 1000 items', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const [store, setStore] = createSolidStore({ items: initialItems })

    setStore('items', items => items.slice(500))
  })

  bench('plain array: splice 500 from 1000 items (baseline)', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const store = { items: initialItems }

    store.items.splice(0, 500)
  })
})

describe('Complex object updates', () => {
  bench('@storable/core: update nested object', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))

    const [store] = createStore({ items: initialItems })

    // Update half the items
    for (let i = 0; i < 500; i++) {
      store.items[i].value = i * 3
    }
  })

  bench('solid-js: update nested object', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))

    const [store, setStore] = createSolidStore({ items: initialItems })

    // Update half the items
    for (let i = 0; i < 500; i++) {
      setStore('items', i,
 'value', i * 3)
    }
  })
})