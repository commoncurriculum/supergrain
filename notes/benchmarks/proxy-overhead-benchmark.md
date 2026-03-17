# Proxy Overhead Benchmark Code

> **Status**: Historical. Benchmark code archive measuring proxy overhead vs direct access.
> **TL;DR**: Simple reads 188.5x slower, nested 990.9x slower, arrays 161.3x slower, store creation 51.2x slower than direct. Overhead compounds from proxy traps (45-83x), getCurrentSub (14x), signal creation (18.8x), symbol access (37x), and Reflect.get/hasOwnProperty (3-15x).

## Benchmark Code

```typescript
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

// Create @supergrain/core versions
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
    // sum prevents optimization
  })

  bench('Basic proxy: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += SIMPLE_PROXY.count
      sum += SIMPLE_PROXY.name.length
      sum += SIMPLE_PROXY.active ? 1 : 0
    }
    // sum prevents optimization
  })

  bench('@supergrain/core: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += STORABLE_SIMPLE.count
      sum += STORABLE_SIMPLE.name.length
      sum += STORABLE_SIMPLE.active ? 1 : 0
    }
    // sum prevents optimization
  })
})

describe('Proxy Overhead: Nested Object Access', () => {
  bench('Direct object: 100k nested reads', () => {
    let sum = 0
    for (let i = 0; i < 100_000; i++) {
      sum += NESTED_OBJECT.level1.level2.level3.value
      sum += NESTED_OBJECT.user.profile.name.length
    }
    // sum prevents optimization
  })

  bench('@supergrain/core: 100k nested reads', () => {
    let sum = 0
    for (let i = 0; i < 100_000; i++) {
      sum += STORABLE_NESTED.level1.level2.level3.value
      sum += STORABLE_NESTED.user.profile.name.length
    }
    // sum prevents optimization
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
    // sum prevents optimization
  })

  bench('@supergrain/core: 10k iterations (100 items each)', () => {
    let sum = 0
    for (let i = 0; i < 10_000; i++) {
      for (const item of STORABLE_ARRAY.items) {
        sum += item.value
      }
    }
    // sum prevents optimization
  })
})

describe('Proxy Overhead: Store Creation', () => {
  bench('Direct object: create 10k objects', () => {
    const objects = []
    for (let i = 0; i < 10_000; i++) {
      objects.push({ id: i, name: `item-${i}`, active: i % 2 === 0 })
    }
    // objects prevents optimization
  })

  bench('Basic proxy: create 10k proxies', () => {
    const objects = []
    for (let i = 0; i < 10_000; i++) {
      const obj = { id: i, name: `item-${i}`, active: i % 2 === 0 }
      objects.push(new Proxy(obj, { get: (t, p) => Reflect.get(t, p) }))
    }
    // objects prevents optimization
  })

  bench('@supergrain/core: create 10k stores', () => {
    const objects = []
    for (let i = 0; i < 10_000; i++) {
      const [store] = createStore({ id: i, name: `item-${i}`, active: i % 2 === 0 })
      objects.push(store)
    }
    // objects prevents optimization
  })
})

describe('Proxy Overhead: Signal Management Overhead', () => {
  bench('alien-signals: create 10k signals', () => {
    const signals = []
    for (let i = 0; i < 10_000; i++) {
      signals.push(signal(i))
    }
    // signals prevents optimization
  })

  bench('alien-signals: 1M signal reads', () => {
    const sig = signal(42)
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += sig()
    }
    // sum prevents optimization
  })

  bench('alien-signals: 100k signal writes', () => {
    const sig = signal(0)
    for (let i = 0; i < 100_000; i++) {
      sig(i)
    }
  })
})

describe('Proxy Overhead: getCurrentSub() Impact', () => {
  bench('Direct access: 1M getCurrentSub() calls', () => {
    let count = 0
    for (let i = 0; i < 1_000_000; i++) {
      if (getCurrentSub()) count++
    }
    // count prevents optimization
  })

  bench('With proxy get trap: 1M getCurrentSub() calls', () => {
    const obj = new Proxy({}, {
      get() {
        return getCurrentSub() ? 1 : 0
      }
    })
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += obj.test
    }
    // sum prevents optimization
  })
})

describe('Proxy Overhead: Property Descriptor Operations', () => {
  bench('Direct object: 100k hasOwnProperty calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      if (Object.prototype.hasOwnProperty.call(SIMPLE_OBJECT, 'count')) count++
      if (Object.prototype.hasOwnProperty.call(SIMPLE_OBJECT, 'name')) count++
    }
    // count prevents optimization
  })

  bench('@supergrain/core: 100k hasOwnProperty calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      if (Object.prototype.hasOwnProperty.call(STORABLE_SIMPLE, 'count')) count++
      if (Object.prototype.hasOwnProperty.call(STORABLE_SIMPLE, 'name')) count++
    }
    // count prevents optimization
  })

  bench('Direct object: 100k Object.keys calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += Object.keys(SIMPLE_OBJECT).length
    }
    // count prevents optimization
  })

  bench('@supergrain/core: 100k Object.keys calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += Object.keys(STORABLE_SIMPLE).length
    }
    // count prevents optimization
  })
})

describe('Proxy Overhead: Memory Allocation Analysis', () => {
  const deepObject = {
    a: { b: { c: { d: { e: { f: 'deep' } } } } }
  }

  bench('Deep object: direct access pattern', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += deepObject.a.b.c.d.e.f.length
    }
    // count prevents optimization
  })

  bench('Deep object: @supergrain/core access pattern', () => {
    const [store] = createStore(deepObject)
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += store.a.b.c.d.e.f.length
    }
    // count prevents optimization
  })
})
```

## Results

| Operation | vs Direct Access |
|-----------|-----------------|
| Simple property access | 188.5x slower |
| Nested object access | 990.9x slower |
| Array operations | 161.3x slower |
| Store creation | 51.2x slower |

## Overhead Sources (Compounding)

| Factor | Overhead |
|--------|----------|
| Proxy handler complexity | 45-83x |
| getCurrentSub() calls | 14x |
| Signal creation (getNode()) | 18.8x |
| Symbol property access ($NODE/$RAW) | 37x |
| Function calls (Reflect.get, hasOwnProperty) | 3-15x |

Originally `packages/core/benchmarks/proxy-overhead.bench.ts`, moved to doc format.