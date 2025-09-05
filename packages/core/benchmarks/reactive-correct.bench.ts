import { bench, describe } from 'vitest'
import { createStore } from '../src/store-optimized'
import { ReactiveStore as ReactiveStoreLegacy } from '../src/store'
import { effect } from 'alien-signals'
import { effect as effectLegacy } from '../src/isTracking'
import { createStore as createSolidStore } from 'solid-js/store'
import { createComputed, createRoot } from 'solid-js'

describe('Reactive Property Access Performance (Correct)', () => {
  bench('@storable/core (optimized): setup effect with 10k reads', () => {
    const [store] = createStore({
      user: {
        name: 'John',
        age: 30,
        profile: {
          email: 'john@example.com',
        },
      },
    })

    let sum = 0
    const dispose = effect(() => {
      for (let i = 0; i < 10000; i++) {
        sum += store.user.age
      }
    })
    dispose()
  })

  bench('@storable/core (legacy): setup effect with 10k reads', () => {
    const store = new ReactiveStoreLegacy()
    store.set('user', 1, {
      name: 'John',
      age: 30,
      profile: {
        email: 'john@example.com',
      },
    })
    const user = store.find('user', 1)!()

    let sum = 0
    effectLegacy(() => {
      for (let i = 0; i < 10000; i++) {
        sum += user.age
      }
    })
  })

  bench('solid-js/store: setup computed with 10k reads', () => {
    const dispose = createRoot(dispose => {
      const [store] = createSolidStore({
        user: {
          name: 'John',
          age: 30,
          profile: {
            email: 'john@example.com',
          },
        },
      })

      let sum = 0
      createComputed(() => {
        sum = 0
        for (let i = 0; i < 10000; i++) {
          sum += store.user.age
        }
      })

      return dispose
    })
    dispose()
  })
})

describe('Reactive Update Performance (Correct)', () => {
  bench('@storable/core (optimized): 1000 updates with active effect', () => {
    const [store, setStore] = createStore({ counter: 0 })

    let value = 0
    const dispose = effect(() => {
      value = store.counter
    })

    for (let i = 1; i <= 1000; i++) {
      setStore('counter', i)
    }

    dispose()
  })

  bench('@storable/core (legacy): 1000 updates with active effect', () => {
    const store = new ReactiveStoreLegacy()
    store.set('data', 1, { counter: 0 })
    const data = store.find('data', 1)!()

    let value = 0
    effectLegacy(() => {
      value = data.counter
    })

    for (let i = 1; i <= 1000; i++) {
      data.counter = i
    }
  })

  bench('solid-js/store: 1000 updates with computed', () => {
    const dispose = createRoot(dispose => {
      const [store, setStore] = createSolidStore({ counter: 0 })

      let value = 0
      createComputed(() => {
        value = store.counter
      })

      for (let i = 1; i <= 1000; i++) {
        setStore('counter', i)
      }

      return dispose
    })
    dispose()
  })
})

describe('Deep Reactive Access (Correct)', () => {
  bench('@storable/core (optimized): deep reactive path', () => {
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

    let result = 0
    const dispose = effect(() => {
      for (let i = 0; i < 1000; i++) {
        result = store.level1.level2.level3.level4.level5.value
      }
    })
    dispose()
  })

  bench('@storable/core (legacy): deep reactive path', () => {
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

    let result = 0
    effectLegacy(() => {
      for (let i = 0; i < 1000; i++) {
        result = data.level1.level2.level3.level4.level5.value
      }
    })
  })

  bench('solid-js/store: deep reactive path with computed', () => {
    const dispose = createRoot(dispose => {
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

      let result = 0
      createComputed(() => {
        for (let i = 0; i < 1000; i++) {
          result = store.level1.level2.level3.level4.level5.value
        }
      })

      return dispose
    })
    dispose()
  })
})

describe('Array Reactive Operations (Correct)', () => {
  bench('@storable/core (optimized): reactive array length tracking', () => {
    const [store] = createStore({ items: [1, 2, 3, 4, 5] })

    let length = 0
    const dispose = effect(() => {
      length = store.items.length
    })

    // Trigger updates
    for (let i = 0; i < 100; i++) {
      store.items.push(i)
    }

    dispose()
  })

  bench('@storable/core (legacy): reactive array length tracking', () => {
    const store = new ReactiveStoreLegacy()
    store.set('data', 1, { items: [1, 2, 3, 4, 5] })
    const data = store.find('data', 1)!()

    let length = 0
    effectLegacy(() => {
      length = data.items.length
    })

    // Trigger updates
    for (let i = 0; i < 100; i++) {
      data.items.push(i)
    }
  })

  bench('solid-js/store: reactive array length tracking with computed', () => {
    const dispose = createRoot(dispose => {
      const [store, setStore] = createSolidStore({ items: [1, 2, 3, 4, 5] })

      let length = 0
      createComputed(() => {
        length = store.items.length
      })

      // Trigger updates
      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }

      return dispose
    })
    dispose()
  })
})

describe('Non-Reactive Property Access (Correct)', () => {
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

  bench('solid-js/store: 100k non-reactive reads', () => {
    const dispose = createRoot(dispose => {
      const [store] = createSolidStore({
        user: { name: 'John', age: 30, email: 'john@example.com' },
      })
      let total = 0
      // Access outside of reactive context - no tracking
      for (let i = 0; i < 100000; i++) {
        total += store.user.age
      }
      return dispose
    })
    dispose()
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

describe('Store Creation Performance (Correct)', () => {
  bench('@storable/core (optimized): create 1000 stores', () => {
    for (let i = 0; i < 1000; i++) {
      const [store, setStore] = createStore({
        id: i,
        name: `Store ${i}`,
        data: { value: i * 2 },
      })
    }
  })

  bench('@storable/core (legacy): create 1000 stores', () => {
    for (let i = 0; i < 1000; i++) {
      const store = new ReactiveStoreLegacy()
      store.set('entity', i, {
        id: i,
        name: `Store ${i}`,
        data: { value: i * 2 },
      })
    }
  })

  bench('solid-js/store: create 1000 stores', () => {
    for (let i = 0; i < 1000; i++) {
      const dispose = createRoot(dispose => {
        const [store, setStore] = createSolidStore({
          id: i,
          name: `Store ${i}`,
          data: { value: i * 2 },
        })
        return dispose
      })
      dispose()
    }
  })
})
