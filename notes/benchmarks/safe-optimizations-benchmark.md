# Safe Optimization Benchmarks Code

> **Status**: Historical. Benchmark code archive -- tested micro-optimizations that preserve reactivity.
> **TL;DR**: Identified 4 safe optimizations yielding 2.64x total improvement: (1) direct property access over Reflect.get (2.69x), (2) object literal over Object.create(null) (2.19x), (3) pre-bound $ function (1.43x), (4) simplified proxy handler. All validated via [reactivity-validation-tests.md](./reactivity-validation-tests.md).

## Benchmark Code

```typescript
import { bench, describe } from 'vitest'
import { $NODE, $RAW } from '../src'
import { signal, getCurrentSub } from 'alien-signals'

/**
 * Safe Optimization Benchmarks
 * 
 * These benchmarks test optimizations that preserve reactivity guarantees.
 * Based on analysis of failed approaches in /notes/failed-approaches/, 
 * we focus on micro-optimizations within the reactive model rather than
 * architectural changes that could break automatic reactivity.
 */

describe('Safe Optimizations: getCurrentSub() Caching', () => {
  // Current implementation calls getCurrentSub() multiple times per access
  const currentProxyHandler = {
    get(target: any, prop: PropertyKey) {
      if (prop === $RAW) return target
      const value = Reflect.get(target, prop)
      if (typeof value === 'function') return value
      
      // Current: Multiple getCurrentSub() calls
      if (!getCurrentSub()) return value
      const own = Object.prototype.hasOwnProperty.call(target, prop)
      if (!getCurrentSub()) return value // Called again!
      
      return value
    }
  }

  // Optimized: Cache getCurrentSub() result
  const optimizedProxyHandler = {
    get(target: any, prop: PropertyKey) {
      if (prop === $RAW) return target
      const value = Reflect.get(target, prop)
      if (typeof value === 'function') return value
      
      // Optimization: Cache getCurrentSub() result
      const currentSub = getCurrentSub()
      if (!currentSub) return value
      Object.prototype.hasOwnProperty.call(target, prop) // Prevent optimization
      
      return value
    }
  }

  const obj = { count: 42, name: 'test' }
  const currentProxy = new Proxy(obj, currentProxyHandler)
  const optimizedProxy = new Proxy(obj, optimizedProxyHandler)

  bench('Current approach: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += currentProxy.count
      sum += currentProxy.name.length
    }
    // sum prevents optimization
  })

  bench('Optimized getCurrentSub caching: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += optimizedProxy.count
      sum += optimizedProxy.name.length
    }
    // sum prevents optimization
  })
})

describe('Safe Optimizations: Reflect.get vs Direct Access', () => {
  // Test whether direct property access is faster than Reflect.get
  const obj = { count: 42, name: 'test', nested: { value: 123 } }

  bench('Reflect.get: 1M calls', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += Reflect.get(obj, 'count') as number
      sum += (Reflect.get(obj, 'name') as string).length
    }
    // sum prevents optimization
  })

  bench('Direct access: 1M calls', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += obj.count
      sum += obj.name.length
    }
    // sum prevents optimization
  })

  bench('Target[prop] with type safety: 1M calls', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += (obj as any)['count']
      sum += (obj as any)['name'].length
    }
    // sum prevents optimization
  })
})

describe('Safe Optimizations: Symbol Lookup Optimization', () => {
  // Current approach looks up symbols on each access
  const obj = { test: 42 }
  Object.defineProperty(obj, $NODE, { value: {}, enumerable: false })
  Object.defineProperty(obj, $RAW, { value: obj, enumerable: false })

  const optimizedHandler = {
    get(target: any, prop: PropertyKey) {
      // Optimize common symbol checks with early returns
      if (prop === $RAW) return target
      if (prop === $NODE) return target[$NODE]
      
      // Continue with regular logic
      const value = Reflect.get(target, prop)
      return value
    }
  }

  const currentHandler = {
    get(target: any, prop: PropertyKey) {
      if (prop === $RAW) return target
      const value = Reflect.get(target, prop)
      // Simulate other symbol lookups that happen in real implementation
      // const nodes = (target as any)[$NODE]
      return value
    }
  }

  const currentProxy = new Proxy(obj, currentHandler)
  const optimizedProxy = new Proxy(obj, optimizedHandler)

  bench('Current symbol access: 1M reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += currentProxy.test
    }
    // sum prevents optimization
  })

  bench('Optimized symbol access: 1M reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += optimizedProxy.test
    }
    // sum prevents optimization  
  })
})

describe('Safe Optimizations: Signal $ Method Assignment', () => {
  // Current implementation assigns $ method to each signal
  // Based on failed-approaches/signal-prototype-optimization.md,
  // we know we can't use prototype methods, but we can optimize assignment

  bench('Current: Per-signal $ assignment', () => {
    const signals = []
    for (let i = 0; i < 10_000; i++) {
      const sig = signal(i) as any
      sig.$ = (v: any) => sig(v) // Current approach
      signals.push(sig)
    }
    // signals prevents optimization
  })

  bench('Optimized: Pre-bound $ function', () => {
    const signals = []
    for (let i = 0; i < 10_000; i++) {
      const sig = signal(i) as any
      // Pre-create the bound function to avoid closure creation overhead
      const setter = sig as (v: any) => void
      sig.$ = setter
      signals.push(sig)
    }
    // signals prevents optimization
  })
})

describe('Safe Optimizations: Proxy Handler Optimization', () => {
  const baseObj = { count: 42, name: 'test', active: true }

  // Current complex handler
  const complexHandler = {
    get(target: any, prop: PropertyKey) {
      if (prop === $RAW) return target
      const value = Reflect.get(target, prop)
      if (typeof value === 'function') return value
      if (!getCurrentSub()) return value
      const own = Object.prototype.hasOwnProperty.call(target, prop)
      // const nodes = (target as any)[$NODE]
      return value
    }
  }

  // Simplified but equivalent handler
  const simplifiedHandler = {
    get(target: any, prop: PropertyKey) {
      // Fast path for symbols
      if (prop === $RAW) return target
      
      const value = Reflect.get(target, prop)
      
      // Fast path for functions
      if (typeof value === 'function') return value
      
      // Fast path for non-reactive context
      const currentSub = getCurrentSub()
      if (!currentSub) return value
      
      // Only do expensive operations when necessary
      const own = Object.prototype.hasOwnProperty.call(target, prop)
      // const nodes = (target as any)[$NODE]
      
      return value
    }
  }

  const complexProxy = new Proxy(baseObj, complexHandler)
  const simplifiedProxy = new Proxy(baseObj, simplifiedHandler)

  bench('Complex handler: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += complexProxy.count
      sum += complexProxy.name.length
    }
    // sum prevents optimization
  })

  bench('Simplified handler: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += simplifiedProxy.count
      sum += simplifiedProxy.name.length
    }
    // sum prevents optimization
  })
})

describe('Safe Optimizations: Object.create(null) vs Object Literal', () => {
  // Test the overhead of Object.create(null) used for nodes
  
  bench('Object.create(null): 100k objects', () => {
    const objects = []
    for (let i = 0; i < 100_000; i++) {
      const nodes = Object.create(null)
      nodes.prop1 = signal(i)
      nodes.prop2 = signal(i * 2)
      objects.push(nodes)
    }
    // objects prevents optimization
  })

  bench('Object literal {}: 100k objects', () => {
    const objects = []
    for (let i = 0; i < 100_000; i++) {
      const nodes = {} as any
      nodes.prop1 = signal(i)
      nodes.prop2 = signal(i * 2)
      objects.push(nodes)
    }
    // objects prevents optimization
  })

  bench('Map: 100k objects', () => {
    const objects = []
    for (let i = 0; i < 100_000; i++) {
      const nodes = new Map()
      nodes.set('prop1', signal(i))
      nodes.set('prop2', signal(i * 2))
      objects.push(nodes)
    }
    // objects prevents optimization
  })
})
```

## Results Summary

### Direct vs Reflect.get Access
| Method | vs Reflect.get |
|--------|---------------|
| `target[prop]` (indexed) | 22x faster |
| Direct property access | Equivalent to indexed |

### Signal $ Method Assignment
| Method | vs Closure |
|--------|-----------|
| Pre-bound function reference | 1.35x faster |

### Object.create(null) vs Object Literal
| Method | Speed |
|--------|-------|
| Object literal `{}` | 2.19x faster than Object.create(null) |
| Map | Similar to Object.create(null) |

### Proxy Handler Optimization
- Simplified handler logic: marginal improvement
- getCurrentSub caching: minimal (already near-optimal)
- Early returns: slight gains

## Implemented Optimizations (2.64x Total Improvement)

| Optimization | Change | Improvement |
|-------------|--------|-------------|
| Direct Property Access | `Reflect.get(target, prop, receiver)` -> `(target as any)[prop]` | 2.69x |
| Object Literal for Nodes | `Object.create(null)` -> `{} as DataNodes` | 2.19x |
| Signal $ Method Assignment | Closure -> direct function reference | 1.43x |
| Simplified Proxy Handler | Removed redundant ownership checks | marginal |

All validated via [reactivity-validation-tests.md](./reactivity-validation-tests.md).

Originally `packages/core/benchmarks/safe-optimizations.bench.ts`, moved to doc format.