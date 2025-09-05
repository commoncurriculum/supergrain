import { bench, describe } from 'vitest'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import { createComputed, createRoot } from 'solid-js'

describe('Reactive Property Access Performance', () => {
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

describe('Reactive Property Updates', () => {
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

describe('Deep Reactive Access', () => {
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

describe('Array Reactive Operations', () => {
  bench('@storable/core (optimized): reactive array push', () => {
    const [store] = createStore({ items: [] as number[] })

    let length = 0
    const dispose = effect(() => {
      length = store.items.length
    })

    for (let i = 0; i < 100; i++) {
      store.items.push(i)
    }

    dispose()
  })

  bench('solid-js/store: reactive array push', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ items: [] as number[] })

      let length = 0
      createComputed(() => {
        length = store.items.length
      })

      for (let i = 0; i < 100; i++) {
        setStore('items', items => [...items, i])
      }

      dispose()
    })
  })
})

describe('Multiple Reactive Dependencies', () => {
  bench('@storable/core (optimized): effect with 3 dependencies', () => {
    const [store] = createStore({
      a: 1,
      b: 2,
      c: 3,
    })

    let sum = 0
    const dispose = effect(() => {
      for (let i = 0; i < 1000; i++) {
        sum = store.a + store.b + store.c
      }
    })

    dispose()
  })

  bench('solid-js/store: effect with 3 dependencies', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({
        a: 1,
        b: 2,
        c: 3,
      })

      let sum = 0
      createComputed(() => {
        for (let i = 0; i < 1000; i++) {
          sum = store.a + store.b + store.c
        }
      })

      dispose()
    })
  })
})
