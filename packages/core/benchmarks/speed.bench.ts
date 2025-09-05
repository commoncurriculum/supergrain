import { bench, describe } from 'vitest'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'
import { ReactiveStore } from '../src/store'
import { effect as storableEffect } from 'alien-signals'

interface Entity {
  id: number
  name: string
  profile: {
    email: string
  }
}

describe('Store Operations: creating 1,000 entities', () => {
  bench('@storable/core', () => {
    const store = new ReactiveStore()
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

describe('Store Operations: retrieving 1,000 entities', () => {
  bench('@storable/core', () => {
    const store = new ReactiveStore()
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

describe('Proxy Reactivity: property access', () => {
  bench('@storable/core: 10,000 reads', () => {
    const store = new ReactiveStore()
    store.set('user', 'current', { name: 'John Doe' })
    const user = store.find('user', 'current')!()
    let dummy
    storableEffect(() => {
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

describe('Proxy Reactivity: property mutation', () => {
  bench('@storable/core: 1,000 updates triggering an effect', () => {
    const store = new ReactiveStore()
    store.set('user', 'current', { name: 'John Doe' })
    const user = store.find('user', 'current')!()
    let dummy
    storableEffect(() => {
      dummy = user.name
    })
    for (let i = 0; i < 1000; i++) {
      user.name = `John Doe ${i}`
    }
  })

  bench('solid-js/store: 1,000 updates triggering an effect', () => {
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

describe('Array Reactivity: adding 1,000 items', () => {
  bench('@storable/core', () => {
    const store = new ReactiveStore()
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

describe('Array Reactivity: removing 1,000 items', () => {
  bench('@storable/core', () => {
    const initialItems = Array.from({ length: 1000 }, (_, i) => i)
    const store = new ReactiveStore()
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
