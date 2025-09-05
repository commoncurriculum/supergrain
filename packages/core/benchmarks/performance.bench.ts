import { bench, describe } from 'vitest'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'
import { createStore } from '../src/store'
import { effect } from 'alien-signals'

describe('Critical Performance: Reactive Property Reads', () => {
  bench('@storable/core: 10k reactive reads in single effect', () => {
    const [store] = createStore({ user: { name: 'John', age: 30 } })
    let total = 0
    const dispose = effect(() => {
      for (let i = 0; i < 10000; i++) {
        total += store.user.age
      }
    })
    dispose()
  })

  bench('solid-js: 10k reactive reads in single effect', () => {
    createRoot(dispose => {
      const [store] = createSolidStore({ user: { name: 'John', age: 30 } })
      let total = 0
      createSolidEffect(() => {
        for (let i = 0; i < 10000; i++) {
          total += store.user.age
        }
      })
      dispose()
    })
  })
})

describe('Critical Performance: Non-Reactive Property Reads', () => {
  bench('@storable/core: 100k non-reactive reads', () => {
    const [store] = createStore({
      user: { name: 'John', age: 30, email: 'john@example.com' },
    })
    let total = 0
    for (let i = 0; i < 100000; i++) {
      total += store.user.age
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
  bench('@storable/core: 1k updates with effect', () => {
    const [store, setStore] = createStore({ counter: 0 })
    let value = 0
    const dispose = effect(() => {
      value = store.counter
    })
    for (let i = 0; i < 1000; i++) {
      setStore('counter', i)
    }
    dispose()
  })

  bench('solid-js: 1k updates with effect', () => {
    createRoot(dispose => {
      const [store, setStore] = createSolidStore({ counter: 0 })
      let value = 0
      createSolidEffect(() => {
        value = store.counter
      })
      for (let i = 0; i < 1000; i++) {
        setStore('counter', i)
      }
      dispose()
    })
  })
})

describe('Critical Performance: Array Operations', () => {
  bench('@storable/core: splice 500 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: i * 2,
    }))
    const [store] = createStore({ items })

    // Remove first 500 items using splice
    store.items.splice(0, 500)
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
  bench('@storable/core: 10k deep reads', () => {
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

describe('Critical Performance: Batch Updates', () => {
  bench('@storable/core: batch 100 property updates', () => {
    const [store] = createStore({
      values: Array.from({ length: 100 }, (_, i) => ({ id: i, value: 0 })),
    })

    // All updates are automatically batched
    for (let i = 0; i < 100; i++) {
      store.values[i].value = i * 2
    }
  })

  bench('solid-js: batch 100 property updates', () => {
    const [store, setStore] = createSolidStore({
      values: Array.from({ length: 100 }, (_, i) => ({ id: i, value: 0 })),
    })

    // Batch updates
    for (let i = 0; i < 100; i++) {
      setStore('values', i, 'value', i * 2)
    }
  })
})

describe('Critical Performance: Memory Patterns', () => {
  bench('@storable/core: create and dispose 100 effects', () => {
    const [store] = createStore({ value: 0 })
    const disposers: (() => void)[] = []

    for (let i = 0; i < 100; i++) {
      disposers.push(
        effect(() => {
          const _ = store.value
        })
      )
    }

    // Clean up
    disposers.forEach(d => d())
  })

  bench('solid-js: create and dispose 100 effects', () => {
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
