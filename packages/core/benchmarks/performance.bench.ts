import { bench, describe } from 'vitest'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'
import { createStore, effect } from '../src/store'

describe('Critical Performance: Reactive Property Reads', () => {
  bench(
    '@storable/core (optimized): 10k reactive reads in single effect',
    () => {
      const [store] = createStore({ user: { name: 'John', age: 30 } })
      let total = 0
      effect(() => {
        for (let i = 0; i < 10000; i++) {
          total += store.user.age
        }
      })
    }
  )

  bench('@storable/core (legacy): 10k reactive reads in single effect', () => {
    const store = new ReactiveStoreLegacy()
    store.set('user', 1, { name: 'John', age: 30 })
    const user = store.find('user', 1)!()
    let total = 0
    effectLegacy(() => {
      for (let i = 0; i < 10000; i++) {
        total += user.age
      }
    })
  })

  bench('solid-js: 10k reactive reads in single effect', () => {
    createRoot(() => {
      const [store] = createSolidStore({ user: { name: 'John', age: 30 } })
      let total = 0
      createSolidEffect(() => {
        for (let i = 0; i < 10000; i++) {
          total += store.user.age
        }
      })
    })
  })
})

describe('Critical Performance: Non-Reactive Property Reads', () => {
  bench('@storable/core (optimized): 100k non-reactive reads', () => {
    const [store] = createStore({
      user: { name: 'John', age: 30, email: 'john@example.com' },
    })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
    }
  })

  bench('@storable/core (legacy): 100k non-reactive reads', () => {
    const store = new ReactiveStoreLegacy()
    store.set('user', 1, { name: 'John', age: 30, email: 'john@example.com' })
    const user = store.find('user', 1)!()
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += user.age
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
    const store = {
      user: { name: 'John', age: 30, email: 'john@example.com' },
    }
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
    }
  })
})

describe('Critical Performance: Property Updates', () => {
  bench('@storable/core (optimized): 1k updates with effect', () => {
    const [store, setStore] = createStore({ counter: 0 })
    let value = 0
    effect(() => {
      value = store.counter
    })
    for (let i = 0; i < 1000; i++) {
      setStore('counter', i)
    }
  })

  bench('@storable/core (legacy): 1k updates with effect', () => {
    const store = new ReactiveStoreLegacy()
    store.set('data', 1, { counter: 0 })
    const data = store.find('data', 1)!()
    let value = 0
    effectLegacy(() => {
      value = data.counter
    })
    for (let i = 0; i < 1000; i++) {
      data.counter = i
    }
  })

  bench('solid-js: 1k updates with effect', () => {
    createRoot(() => {
      const [store, setStore] = createSolidStore({ counter: 0 })
      let value = 0
      createSolidEffect(() => {
        value = store.counter
      })
      for (let i = 0; i < 1000; i++) {
        setStore('counter', i)
      }
    })
  })
})

describe('Critical Performance: Array Operations', () => {
  bench('@storable/core (optimized): splice 500 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))
    const [store] = createStore({ items })

    // Remove first 500 items using splice
    store.items.splice(0, 500)
  })

  bench('@storable/core (legacy): splice 500 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))
    const store = new ReactiveStoreLegacy()
    store.set('data', 1, { items })
    const data = store.find('data', 1)!()

    // Remove first 500 items using splice
    data.items.splice(0, 500)
  })

  bench('solid-js: remove 500 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))
    const [store, setStore] = createSolidStore({ items })

    // Remove first 500 items (immutable)
    setStore('items', items => items.slice(500))
  })

  bench('plain array: splice 500 items (baseline)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))
    const store = { items }

    // Remove first 500 items using splice
    store.items.splice(0, 500)
  })
})

describe('Critical Performance: Deep Object Access', () => {
  bench('@storable/core (optimized): 10k deep reads', () => {
    const [store] = createStore({
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 42,
              },
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

  bench('@storable/core (legacy): 10k deep reads', () => {
    const store = new ReactiveStoreLegacy()
    store.set('data', 1, {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 42,
              },
            },
          },
        },
      },
    })
    const data = store.find('data', 1)!()

    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += data.level1.level2.level3.level4.level5.value
    }
  })

  bench('solid-js: 10k deep reads', () => {
    const [store] = createSolidStore({
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 42,
              },
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

  bench('plain object: 10k deep reads (baseline)', () => {
    const store = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 42,
              },
            },
          },
        },
      },
    }

    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.level1.level2.level3.level4.level5.value
    }
  })
})

describe('Critical Performance: Store Creation', () => {
  bench('@storable/core (optimized): create 1k stores', () => {
    for (let i = 0; i < 1000; i++) {
      const [store, setStore] = createStore({
        id: i,
        name: `Store ${i}`,
        data: { value: i * 2 },
      })
    }
  })

  bench('@storable/core (legacy): create 1k stores', () => {
    for (let i = 0; i < 1000; i++) {
      const store = new ReactiveStoreLegacy()
      store.set('entity', i, {
        id: i,
        name: `Store ${i}`,
        data: { value: i * 2 },
      })
    }
  })

  bench('solid-js: create 1k stores', () => {
    for (let i = 0; i < 1000; i++) {
      const [store, setStore] = createSolidStore({
        id: i,
        name: `Store ${i}`,
        data: { value: i * 2 },
      })
    }
  })
})
