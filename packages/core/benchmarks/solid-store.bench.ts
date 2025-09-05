import { bench, describe } from 'vitest'
import { createStore } from 'solid-js/store'
import { createEffect, createRoot } from 'solid-js'

interface Entity {
  id: number
  name: string
  profile: {
    email: string
  }
}

describe('Speed Benchmarks - Solid Store > Store Operations', () => {
  bench('setStore(): creating 1,000 entities', () => {
    const [, setStore] = createStore<{ entities: Record<number, Entity> }>({
      entities: {},
    })

    for (let i = 0; i < 1000; i++) {
      const entity: Entity = {
        id: i,
        name: `Entity ${i}`,
        profile: { email: `entity${i}@test.com` },
      }
      setStore('entities', i, entity)
    }
  })

  bench('find(): retrieving 1,000 entities', () => {
    const initialEntities: Record<number, Entity> = {}
    for (let i = 0; i < 1000; i++) {
      initialEntities[i] = {
        id: i,
        name: `Entity ${i}`,
        profile: { email: `entity${i}@test.com` },
      }
    }
    const [store] = createStore<{ entities: Record<number, Entity> }>({
      entities: initialEntities,
    })

    for (let i = 0; i < 1000; i++) {
      // Reading directly from the store proxy
      const _entity = store.entities[i]
    }
  })
})

describe('Speed Benchmarks - Solid Store > Proxy Reactivity', () => {
  bench('property access: 10,000 reads (reactive)', () => {
    let dummy
    createRoot(() => {
      const [store] = createStore<{ user: { name: string } }>({
        user: { name: 'John Doe' },
      })

      createEffect(() => {
        for (let i = 0; i < 10000; i++) {
          dummy = store.user.name
        }
      })
    })
  })

  bench('property mutation: 1,000 updates triggering an effect', () => {
    let dummy // To prevent dead code elimination
    // Solid's effects must run in a reactive root.
    createRoot(() => {
      const [store, setStore] = createStore<{ user: { name: string } }>({
        user: { name: 'John Doe' },
      })

      // Establish a dependency so the write has a subscriber to notify
      createEffect(() => {
        dummy = store.user.name
      })

      for (let i = 0; i < 1000; i++) {
        // Use the explicit setter for the write operation
        setStore('user', 'name', `John Doe ${i}`)
      }
    })
  })
})

describe('Speed Benchmarks - Solid Store > Array Reactivity', () => {
  bench('push(): adding 1,000 items to an array', () => {
    const [, setStore] = createStore<{ items: number[] }>({ items: [] })
    for (let i = 0; i < 1000; i++) {
      // Using the idiomatic SolidJS pattern (immutable update)
      setStore('items', items => [...items, i])
    }
  })

  bench('splice(): removing 1,000 items from an array', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const [, setStore] = createStore<{ items: number[] }>({
      items: initialItems,
    })

    for (let i = 0; i < 1000; i++) {
      // Using the idiomatic SolidJS pattern for removal (immutable)
      setStore('items', items => items.slice(1))
    }
  })
})
