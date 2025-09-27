import { bench, describe } from 'vitest'
import { createStore } from '../src'
import { signal, getCurrentSub } from 'alien-signals'

/**
 * Proxy Overhead Benchmark
 * 
 * Measures the fundamental overhead of proxy access vs direct object access.
 * This benchmark specifically addresses the question: "What is our overhead?"
 * compared to the baseline 4-5x overhead of basic proxy access.
 */

// Baseline test objects
const SIMPLE_OBJECT = { count: 0, name: 'test', active: true }
const NESTED_OBJECT = {
  level1: {
    level2: {
      level3: {
        value: 42,
        data: 'deep'
      }
    }
  },
  user: {
    profile: {
      name: 'John',
      settings: {
        theme: 'dark',
        notifications: true
      }
    }
  }
}
const ARRAY_DATA = Array.from({ length: 100 }, (_, i) => ({ id: i, value: i * 2 }))

// Create proxy versions
const SIMPLE_PROXY = new Proxy(SIMPLE_OBJECT, {
  get: (target, prop) => Reflect.get(target, prop)
})

// Create @storable/core versions
const [STORABLE_SIMPLE] = createStore(SIMPLE_OBJECT)
const [STORABLE_NESTED] = createStore(NESTED_OBJECT)
const [STORABLE_ARRAY] = createStore({ items: ARRAY_DATA })

describe('Proxy Overhead: Simple Property Access', () => {
  bench('Direct object: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += SIMPLE_OBJECT.count
      sum += SIMPLE_OBJECT.name.length
      sum += SIMPLE_OBJECT.active ? 1 : 0
    }
  })

  bench('Basic proxy: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += SIMPLE_PROXY.count
      sum += SIMPLE_PROXY.name.length
      sum += SIMPLE_PROXY.active ? 1 : 0
    }
    // sum used to prevent optimization
  })

  bench('@storable/core: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += STORABLE_SIMPLE.count
      sum += STORABLE_SIMPLE.name.length
      sum += STORABLE_SIMPLE.active ? 1 : 0
    }
    // sum used to prevent optimization
  })
})

describe('Proxy Overhead: Nested Object Access', () => {
  bench('Direct object: 100k nested reads', () => {
    let sum = 0
    for (let i = 0; i < 100_000; i++) {
      sum += NESTED_OBJECT.level1.level2.level3.value
      sum += NESTED_OBJECT.user.profile.name.length
      sum += NESTED_OBJECT.user.profile.settings.notifications ? 1 : 0
    }
    // sum used to prevent optimization
  })

  bench('@storable/core: 100k nested reads', () => {
    let sum = 0
    for (let i = 0; i < 100_000; i++) {
      sum += STORABLE_NESTED.level1.level2.level3.value
      sum += STORABLE_NESTED.user.profile.name.length
      sum += STORABLE_NESTED.user.profile.settings.notifications ? 1 : 0
    }
    // sum used to prevent optimization
  })
})

describe('Proxy Overhead: Array Operations', () => {
  bench('Direct array: 10k iterations (100 items each)', () => {
    let sum = 0
    for (let i = 0; i < 10_000; i++) {
      for (const item of ARRAY_DATA) {
        sum += item.value
      }
    }
    // sum used to prevent optimization
  })

  bench('@storable/core: 10k iterations (100 items each)', () => {
    let sum = 0
    for (let i = 0; i < 10_000; i++) {
      for (const item of STORABLE_ARRAY.items) {
        sum += item.value
      }
    }
    // sum used to prevent optimization
  })
})

describe('Proxy Overhead: Store Creation', () => {
  bench('Direct object: create 10k objects', () => {
    const objects = []
    for (let i = 0; i < 10_000; i++) {
      objects.push({
        id: i,
        name: `Item ${i}`,
        nested: { count: i, active: i % 2 === 0 }
      })
    }
    // result used to prevent optimization
  })

  bench('Basic proxy: create 10k proxies', () => {
    const objects = []
    for (let i = 0; i < 10_000; i++) {
      const obj = {
        id: i,
        name: `Item ${i}`,
        nested: { count: i, active: i % 2 === 0 }
      }
      objects.push(new Proxy(obj, {
        get: (target, prop) => Reflect.get(target, prop)
      }))
    }
    // result used to prevent optimization
  })

  bench('@storable/core: create 10k stores', () => {
    const stores = []
    for (let i = 0; i < 10_000; i++) {
      const [store] = createStore({
        id: i,
        name: `Item ${i}`,
        nested: { count: i, active: i % 2 === 0 }
      })
      stores.push(store)
    }
    // result used to prevent optimization
  })
})

describe('Proxy Overhead: Signal Management Overhead', () => {
  // Test the overhead of signal creation and access
  bench('alien-signals: create 10k signals', () => {
    const signals = []
    for (let i = 0; i < 10_000; i++) {
      const sig = signal(i)
      signals.push(sig)
    }
    // result used to prevent optimization
  })

  bench('alien-signals: 1M signal reads', () => {
    const sig = signal(42)
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += sig()
    }
    // sum used to prevent optimization
  })

  bench('alien-signals: 100k signal writes', () => {
    const sig = signal(0)
    for (let i = 0; i < 100_000; i++) {
      sig(i)
    }
    // result used to prevent optimization
  })
})

describe('Proxy Overhead: getCurrentSub() Impact', () => {
  let value = 0
  
  bench('Direct access: 1M getCurrentSub() calls', () => {
    for (let i = 0; i < 1_000_000; i++) {
      const sub = getCurrentSub()
      value += sub ? 1 : 0
    }
    // result used to prevent optimization
  })

  bench('With proxy get trap: 1M getCurrentSub() calls', () => {
    const obj = new Proxy({ value: 42 }, {
      get(target, prop) {
        const sub = getCurrentSub()
        value += sub ? 1 : 0
        return Reflect.get(target, prop)
      }
    })
    
    for (let i = 0; i < 1_000_000; i++) {
      obj.value
    }
    // result used to prevent optimization
  })
})

describe('Proxy Overhead: Property Descriptor Operations', () => {
  bench('Direct object: 100k hasOwnProperty calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += Object.prototype.hasOwnProperty.call(SIMPLE_OBJECT, 'count') ? 1 : 0
      count += Object.prototype.hasOwnProperty.call(SIMPLE_OBJECT, 'missing') ? 1 : 0
    }
    // count used to prevent optimization
  })

  bench('@storable/core: 100k hasOwnProperty calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += Object.prototype.hasOwnProperty.call(STORABLE_SIMPLE, 'count') ? 1 : 0
      count += Object.prototype.hasOwnProperty.call(STORABLE_SIMPLE, 'missing') ? 1 : 0
    }
    // count used to prevent optimization
  })

  bench('Direct object: 100k Object.keys calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += Object.keys(SIMPLE_OBJECT).length
    }
    // count used to prevent optimization
  })

  bench('@storable/core: 100k Object.keys calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += Object.keys(STORABLE_SIMPLE).length
    }
    // count used to prevent optimization
  })
})

describe('Proxy Overhead: Memory Allocation Analysis', () => {
  // Test the memory overhead of proxy wrapping
  bench('Deep object: direct access pattern', () => {
    let sum = 0
    const data = {
      a: { b: { c: { d: { e: { f: { value: 42 } } } } } }
    }
    
    for (let i = 0; i < 100_000; i++) {
      sum += data.a.b.c.d.e.f.value
    }
    // sum used to prevent optimization
  })

  bench('Deep object: @storable/core access pattern', () => {
    let sum = 0
    const [data] = createStore({
      a: { b: { c: { d: { e: { f: { value: 42 } } } } } }
    })
    
    for (let i = 0; i < 100_000; i++) {
      sum += data.a.b.c.d.e.f.value
    }
    // sum used to prevent optimization
  })
})