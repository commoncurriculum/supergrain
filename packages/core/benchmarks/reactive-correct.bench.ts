import { bench, describe } from 'vitest'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import { createComputed, createRoot } from 'solid-js'

describe('Reactive Property Access Performance (Correct)', () => {
  bench('@storable/core: setup effect with 10k reads', () => {
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

  bench('solid-js/store: setup effect with 10k reads', () => {
    createRoot(dispose => {
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
        for (let i = 0; i < 10000; i++) {
          sum += store.user.age
        }
      })

      dispose()
    })
  })
})

describe('Reactive Update Performance (Correct)', () => {
  bench('@storable/core: 1000 updates with active effect', () => {
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

  bench('solid-js/store: 1000 updates with active effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ counter: 0 })

      let value = 0
      createComputed(() => {
        value = store.counter
      })

      for (let i = 1; i <= 1000; i++) {
        setStore('counter', i)
      }

      dispose()
    })
  })
})

describe('Deep Reactive Access (Correct)', () => {
  bench('@storable/core: deep reactive path', () => {
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

  bench('solid-js/store: deep reactive path', () => {
    createRoot(dispose => {
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

      dispose()
    })
  })
})

describe('Array Reactive Operations (Correct)', () => {
  bench('@storable/core: reactive array length tracking', () => {
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

  bench('solid-js/store: reactive array length tracking', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ items: [1, 2, 3, 4, 5] })

      let length = 0
      createComputed(() => {
        length = store.items.length
      })

      // Trigger updates
      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }

      dispose()
    })
  })
})

describe('Non-Reactive Property Access (Correct)', () => {
  bench('@storable/core: 100k non-reactive reads', () => {
    const [store] = createStore({
      user: { name: 'John', age: 30, email: 'john@example.com' },
    })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
    }
  })

  bench('solid-js/store: 100k non-reactive reads', () => {
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

describe('Store Creation Performance (Correct)', () => {
  bench('@storable/core: create 1k stores', () => {
    for (let i = 0; i < 1000; i++) {
      const [store, setStore] = createStore({
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
