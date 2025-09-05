import { bench, describe } from 'vitest'
import { createStore } from '../src/store'
import { ReactiveStore as ReactiveStoreLegacy } from '../src/store'
import { effect } from 'alien-signals'
import { effect as effectLegacy } from '../src/isTracking'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect, createRoot } from 'solid-js'

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
      createEffect(() => {
        for (let i = 0; i < 10000; i++) {
          sum += store.user.age
        }
      })

      dispose()
    })
  })
})

describe('Reactive Update Performance', () => {
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

  bench('solid-js/store: 1000 updates with active effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ counter: 0 })

      let value = 0
      createEffect(() => {
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
      createEffect(() => {
        for (let i = 0; i < 1000; i++) {
          result = store.level1.level2.level3.level4.level5.value
        }
      })

      dispose()
    })
  })
})

describe('Array Reactive Operations', () => {
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

  bench('solid-js/store: reactive array length tracking', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ items: [1, 2, 3, 4, 5] })

      let length = 0
      createEffect(() => {
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

describe('Effect Creation Overhead', () => {
  bench('@storable/core (optimized): create 100 effects', () => {
    const [store] = createStore({ value: 0 })

    const disposers: (() => void)[] = []
    for (let i = 0; i < 100; i++) {
      disposers.push(
        effect(() => {
          const _ = store.value
        })
      )
    }

    disposers.forEach(d => d())
  })

  bench('@storable/core (legacy): create 100 effects', () => {
    const store = new ReactiveStoreLegacy()
    store.set('data', 1, { value: 0 })
    const data = store.find('data', 1)!()

    for (let i = 0; i < 100; i++) {
      effectLegacy(() => {
        const _ = data.value
      })
    }
  })

  bench('solid-js/store: create 100 effects', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ value: 0 })

      for (let i = 0; i < 100; i++) {
        createEffect(() => {
          const _ = store.value
        })
      }

      dispose()
    })
  })
})
