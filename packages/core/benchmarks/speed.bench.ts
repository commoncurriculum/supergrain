import { bench, describe } from 'vitest'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect, createRoot } from 'solid-js'

interface Entity {
  id: number
  name: string
  email: string
  profile: {
    age: number
    city: string
  }
}

describe('Store Operations', () => {
  describe('creating 1,000 entities', () => {
    bench('@storable/core', () => {
      const entities: any[] = []
      for (let i = 0; i < 1000; i++) {
        const [store] = createStore<Entity>({
          id: i,
          name: `Entity ${i}`,
          email: `entity${i}@test.com`,
          profile: {
            age: 20 + (i % 50),
            city: `City ${i % 10}`,
          },
        })
        entities.push(store)
      }
    })

    bench('solid-js/store', () => {
      const entities: any[] = []
      for (let i = 0; i < 1000; i++) {
        const [store] = createSolidStore<Entity>({
          id: i,
          name: `Entity ${i}`,
          email: `entity${i}@test.com`,
          profile: {
            age: 20 + (i % 50),
            city: `City ${i % 10}`,
          },
        })
        entities.push(store)
      }
    })
  })

  describe('retrieving 1,000 entities', () => {
    bench('@storable/core', () => {
      // Create entities first
      const entities: Entity[] = []
      for (let i = 0; i < 1000; i++) {
        const [store] = createStore<Entity>({
          id: i,
          name: `Entity ${i}`,
          email: `entity${i}@test.com`,
          profile: {
            age: 20 + (i % 50),
            city: `City ${i % 10}`,
          },
        })
        entities.push(store)
      }

      // Access them
      let sum = 0
      for (const entity of entities) {
        sum += entity.profile.age
      }
    })

    bench('solid-js/store', () => {
      // Create entities first
      const entities: Entity[] = []
      for (let i = 0; i < 1000; i++) {
        const [store] = createSolidStore<Entity>({
          id: i,
          name: `Entity ${i}`,
          email: `entity${i}@test.com`,
          profile: {
            age: 20 + (i % 50),
            city: `City ${i % 10}`,
          },
        })
        entities.push(store)
      }

      // Access them
      let sum = 0
      for (const entity of entities) {
        sum += entity.profile.age
      }
    })
  })
})

describe('Proxy Reactivity', () => {
  describe('property access', () => {
    bench('@storable/core: 10,000 reads', () => {
      const [store] = createStore({
        user: { name: 'John Doe', age: 30 },
      })

      let sum = 0
      for (let i = 0; i < 10000; i++) {
        sum += store.user.age
      }
    })

    bench('solid-js/store: 10,000 reads', () => {
      const [store] = createSolidStore({
        user: { name: 'John Doe', age: 30 },
      })

      let sum = 0
      for (let i = 0; i < 10000; i++) {
        sum += store.user.age
      }
    })
  })

  describe('property mutation', () => {
    bench('@storable/core: 1,000 updates triggering an effect', () => {
      const [store] = createStore({ count: 0 })

      let value = 0
      const dispose = effect(() => {
        value = store.count
      })

      for (let i = 0; i < 1000; i++) {
        store.count = i
      }

      dispose()
    })

    bench('solid-js/store: 1,000 updates triggering an effect', () => {
      createRoot(dispose => {
        const [store, setStore] = createSolidStore({ count: 0 })

        let value = 0
        createEffect(() => {
          value = store.count
        })

        for (let i = 0; i < 1000; i++) {
          setStore('count', i)
        }

        dispose()
      })
    })
  })
})

describe('Array Reactivity', () => {
  describe('adding 1,000 items', () => {
    bench('@storable/core', () => {
      const [store] = createStore({ items: [] as number[] })

      for (let i = 0; i < 1000; i++) {
        store.items.push(i)
      }
    })

    bench('solid-js/store', () => {
      const [store, setStore] = createSolidStore({ items: [] as number[] })

      for (let i = 0; i < 1000; i++) {
        setStore('items', items => [...items, i])
      }
    })
  })

  describe('removing 1,000 items', () => {
    bench('@storable/core', () => {
      const initialItems = Array.from({ length: 1000 }, (_, i) => i)
      const [store] = createStore({ items: initialItems })

      for (let i = 0; i < 1000; i++) {
        store.items.pop()
      }
    })

    bench('solid-js/store', () => {
      const initialItems = Array.from({ length: 1000 }, (_, i) => i)
      const [store, setStore] = createSolidStore({ items: initialItems })

      for (let i = 0; i < 1000; i++) {
        setStore('items', items => items.slice(0, -1))
      }
    })
  })
})
