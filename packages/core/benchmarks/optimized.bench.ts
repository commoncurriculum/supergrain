import { bench, describe } from 'vitest'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'
import { ReactiveStore, createStore, effect } from '../src/store'
import { ReactiveStore as ReactiveStoreLegacy } from '../src/store'
import { effect as effectLegacy } from '../src/isTracking'

interface Entity {
  id: number
  name: string
  profile: {
    email: string
  }
}

describe('Optimized Store: creating 1,000 entities', () => {
  bench('@storable/core (optimized)', () => {
    const [store, setStore] = createStore<{ entities: Record<number, Entity> }>(
      {
        entities: {},
      }
    )
    for (let i = 0; i < 1000; i++) {
      const entity: Entity = {
        id: i,
        name: `Entity ${i}`,
        profile: { email: `entity${i}@test.com` },
      }
      setStore('entities', i, entity)
    }
  })

  bench('@storable/core (legacy)', () => {
    const store = new ReactiveStoreLegacy()
    for (let i = 0; i < 1000; i++) {
      const entity: Entity = {
        id: i,
        name: `Entity ${i}`,
        profile: { email: `entity${i}@test.com` },
      }
      store.set('entities', i, entity)
    }
  })

  bench('solid-js/store', () => {
    const [, setStore] = createSolidStore<{ entities: Record<number, Entity> }>(
      {
        entities: {},
      }
    )
    for (let i = 0; i < 1000; i++) {
      const entity: Entity = {
        id: i,
        name: `Entity ${i}`,
        profile: { email: `entity${i}@test.com` },
      }
      setStore('entities', i, entity)
    }
  })
})

describe('Optimized Store: retrieving 1,000 entities', () => {
  bench('@storable/core (optimized)', () => {
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
      const _entity = store.entities[i]
    }
  })

  bench('@storable/core (legacy)', () => {
    const store = new ReactiveStoreLegacy()
    for (let i = 0; i < 1000; i++) {
      store.set('entities', i, {
        id: i,
        name: `Entity ${i}`,
        profile: { email: `entity${i}@test.com` },
      })
    }
    for (let i = 0; i < 1000; i++) {
      store.find('entities', i)
    }
  })

  bench('solid-js/store', () => {
    const initialEntities: Record<number, Entity> = {}
    for (let i = 0; i < 1000; i++) {
      initialEntities[i] = {
        id: i,
        name: `Entity ${i}`,
        profile: { email: `entity${i}@test.com` },
      }
    }
    const [store] = createSolidStore<{ entities: Record<number, Entity> }>({
      entities: initialEntities,
    })
    for (let i = 0; i < 1000; i++) {
      const _entity = store.entities[i]
    }
  })
})

describe('Optimized Proxy: property access', () => {
  bench('@storable/core (optimized): 10,000 reads', () => {
    const [store] = createStore<{ user: { name: string } }>({
      user: { name: 'John Doe' },
    })
    let dummy
    effect(() => {
      for (let i = 0; i < 10000; i++) {
        dummy = store.user.name
      }
    })
  })

  bench('@storable/core (legacy): 10,000 reads', () => {
    const store = new ReactiveStoreLegacy()
    store.set('user', 'current', { name: 'John Doe' })
    const user = store.find('user', 'current')!()
    let dummy
    effectLegacy(() => {
      for (let i = 0; i < 10000; i++) {
        dummy = user.name
      }
    })
  })

  bench('solid-js/store: 10,000 reads (reactive)', () => {
    let dummy
    createRoot(() => {
      const [store] = createSolidStore<{ user: { name: string } }>({
        user: { name: 'John Doe' },
      })
      createSolidEffect(() => {
        for (let i = 0; i < 10000; i++) {
          dummy = store.user.name
        }
      })
    })
  })
})

describe('Optimized Proxy: property mutation', () => {
  bench('@storable/core (optimized): 1,000 updates', () => {
    const [store, setStore] = createStore<{ user: { name: string } }>({
      user: { name: 'John Doe' },
    })
    let dummy
    effect(() => {
      dummy = store.user.name
    })
    for (let i = 0; i < 1000; i++) {
      setStore('user', 'name', `John Doe ${i}`)
    }
  })

  bench('@storable/core (legacy): 1,000 updates', () => {
    const store = new ReactiveStoreLegacy()
    store.set('user', 'current', { name: 'John Doe' })
    const user = store.find('user', 'current')!()
    let dummy
    effectLegacy(() => {
      dummy = user.name
    })
    for (let i = 0; i < 1000; i++) {
      user.name = `John Doe ${i}`
    }
  })

  bench('solid-js/store: 1,000 updates', () => {
    createRoot(() => {
      const [store, setStore] = createSolidStore<{ user: { name: string } }>({
        user: { name: 'John Doe' },
      })
      let dummy
      createSolidEffect(() => {
        dummy = store.user.name
      })
      for (let i = 0; i < 1000; i++) {
        setStore('user', 'name', `John Doe ${i}`)
      }
    })
  })
})

describe('Optimized Arrays: adding 1,000 items', () => {
  bench('@storable/core (optimized)', () => {
    const [store, setStore] = createStore<{ items: number[] }>({ items: [] })
    for (let i = 0; i < 1000; i++) {
      store.items.push(i)
    }
  })

  bench('@storable/core (legacy)', () => {
    const store = new ReactiveStoreLegacy()
    store.set('items', 'all', { data: [] })
    const items = store.find('items', 'all')!().data
    for (let i = 0; i < 1000; i++) {
      items.push(i)
    }
  })

  bench('solid-js/store', () => {
    const [, setStore] = createSolidStore<{ items: number[] }>({ items: [] })
    for (let i = 0; i < 1000; i++) {
      setStore('items', items => [...items, i])
    }
  })
})

describe('Optimized Arrays: removing 1,000 items', () => {
  bench('@storable/core (optimized)', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore<{ items: number[] }>({ items: initialItems })
    for (let i = 0; i < 1000; i++) {
      store.items.splice(0, 1)
    }
  })

  bench('@storable/core (legacy)', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const store = new ReactiveStoreLegacy()
    store.set('items', 'all', { data: initialItems })
    const items = store.find('items', 'all')!().data
    for (let i = 0; i < 1000; i++) {
      items.splice(0, 1)
    }
  })

  bench('solid-js/store', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const [, setStore] = createSolidStore<{ items: number[] }>({
      items: initialItems,
    })
    for (let i = 0; i < 1000; i++) {
      setStore('items', items => items.slice(1))
    }
  })
})

describe('Optimized Arrays: direct mutation', () => {
  bench('@storable/core (optimized): direct splice', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))
    const [store] = createStore<{ items: typeof initialItems }>({
      items: initialItems,
    })

    // Remove first 500 items
    store.items.splice(0, 500)
    // Add 500 new items at the beginning
    store.items.unshift(
      ...Array.from({ length: 500 }, (_, i) => ({ id: i + 1000, value: i * 3 }))
    )
    // Update middle items
    for (let i = 250; i < 750 && i < store.items.length; i++) {
      store.items[i].value *= 2
    }
  })

  bench('solid-js/store: immutable updates', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))
    const [store, setStore] = createSolidStore<{ items: typeof initialItems }>({
      items: initialItems,
    })

    // Remove first 500 items
    setStore('items', items => items.slice(500))
    // Add 500 new items at the beginning
    setStore('items', items => [
      ...Array.from({ length: 500 }, (_, i) => ({
        id: i + 1000,
        value: i * 3,
      })),
      ...items,
    ])
    // Update middle items
    for (let i = 250; i < 750 && i < store.items.length; i++) {
      setStore('items', i, 'value', v => v * 2)
    }
  })
})

describe('Non-reactive reads (outside effect)', () => {
  bench('@storable/core (optimized): 100,000 non-reactive reads', () => {
    const [store] = createStore<{
      user: { name: string; age: number; profile: { email: string } }
    }>({
      user: {
        name: 'John Doe',
        age: 30,
        profile: { email: 'john@example.com' },
      },
    })
    let dummy
    for (let i = 0; i < 100000; i++) {
      dummy = store.user.name
      dummy = store.user.age
      dummy = store.user.profile.email
    }
  })

  bench('@storable/core (legacy): 100,000 non-reactive reads', () => {
    const store = new ReactiveStoreLegacy()
    store.set('user', 'current', {
      name: 'John Doe',
      age: 30,
      profile: { email: 'john@example.com' },
    })
    const user = store.find('user', 'current')!()
    let dummy
    for (let i = 0; i < 100000; i++) {
      dummy = user.name
      dummy = user.age
      dummy = user.profile.email
    }
  })

  bench('solid-js/store: 100,000 non-reactive reads', () => {
    const [store] = createSolidStore<{
      user: { name: string; age: number; profile: { email: string } }
    }>({
      user: {
        name: 'John Doe',
        age: 30,
        profile: { email: 'john@example.com' },
      },
    })
    let dummy
    for (let i = 0; i < 100000; i++) {
      dummy = store.user.name
      dummy = store.user.age
      dummy = store.user.profile.email
    }
  })
})
