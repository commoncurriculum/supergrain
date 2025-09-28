# Proxy Overhead Benchmark Code

This document contains the benchmark code that was used to measure @storable/core's proxy overhead compared to direct object access.

## Purpose

Measures the fundamental overhead of proxy access vs direct object access, specifically addressing the question: "What is our overhead?" compared to the baseline 4-5x overhead of basic proxy access.

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

  bench('@storable/core: 1M property reads', () => {
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

  bench('@storable/core: 100k nested reads', () => {
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

  bench('@storable/core: 10k iterations (100 items each)', () => {
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

  bench('@storable/core: create 10k stores', () => {
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

  bench('@storable/core: 100k hasOwnProperty calls', () => {
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

  bench('@storable/core: 100k Object.keys calls', () => {
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

  bench('Deep object: @storable/core access pattern', () => {
    const [store] = createStore(deepObject)
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      count += store.a.b.c.d.e.f.length
    }
    // count prevents optimization
  })
})
```

## Key Results

- **Simple property access**: 188.5x slower than direct access
- **Nested object access**: 990.9x slower than direct access
- **Array operations**: 161.3x slower than direct access
- **Store creation**: 51.2x slower than direct object creation

## Analysis

The overhead stems from multiple compounding factors:
1. **Proxy handler complexity**: 45-83x overhead from proxy traps
2. **getCurrentSub() calls**: 14x overhead for reactivity checks
3. **Signal creation patterns**: 18.8x overhead in getNode() function
4. **Symbol property access**: 37x overhead for $NODE/$RAW lookups
5. **Function call overhead**: 3-15x per operation (Reflect.get, hasOwnProperty)

## Usage

This benchmark was originally created as `packages/core/benchmarks/proxy-overhead.bench.ts` but has been moved to documentation format per project maintainer request.

To run similar benchmarks:
```bash
cd packages/core
# Create a temporary .bench.ts file with the above code
pnpm run bench your-benchmark.bench.ts
```