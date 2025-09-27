import { bench, describe } from 'vitest'
import { $RAW, $NODE, $VERSION } from '../src'
import { signal, getCurrentSub } from 'alien-signals'

/**
 * Allocation Analysis Benchmark
 * 
 * This benchmark focuses on identifying the specific allocations and overhead
 * sources that contribute to the performance degradation in @storable/core.
 */

describe('Allocation Analysis: Function Call Overhead', () => {
  const directObj = { count: 0, name: 'test', nested: { value: 42 } }

  bench('Direct property access: 1M calls', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += directObj.count
    }
    // sum used to prevent optimization
  })

  bench('Reflect.get calls: 1M calls', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += Reflect.get(directObj, 'count')
    }
    // sum used to prevent optimization
  })

  bench('getCurrentSub: 1M calls', () => {
    let count = 0
    for (let i = 0; i < 1_000_000; i++) {
      const sub = getCurrentSub()
      count += sub ? 1 : 0
    }
    // count used to prevent optimization
  })

  bench('Object.prototype.hasOwnProperty: 1M calls', () => {
    let count = 0
    for (let i = 0; i < 1_000_000; i++) {
      count += Object.prototype.hasOwnProperty.call(directObj, 'count') ? 1 : 0
    }
    // count used to prevent optimization
  })
})

describe('Allocation Analysis: Symbol Access Performance', () => {
  const obj = { test: 42 }
  Object.defineProperty(obj, $NODE, { value: {}, enumerable: false })
  Object.defineProperty(obj, $RAW, { value: obj, enumerable: false })
  
  bench('Regular property access: 1M calls', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += obj.test
    }
    // sum used to prevent optimization
  })

  bench('Symbol property access ($NODE): 1M calls', () => {
    let count = 0
    for (let i = 0; i < 1_000_000; i++) {
      const nodes = (obj as any)[$NODE]
      count += nodes ? 1 : 0
    }
    // count used to prevent optimization
  })

  bench('Symbol property access ($RAW): 1M calls', () => {
    let count = 0
    for (let i = 0; i < 1_000_000; i++) {
      const raw = (obj as any)[$RAW]
      count += raw ? 1 : 0
    }
    // count used to prevent optimization
  })
})

describe('Allocation Analysis: Proxy Handler Overhead', () => {
  const baseObj = { count: 42, name: 'test' }
  
  // Minimal proxy (just get trap)
  const minimalProxy = new Proxy(baseObj, {
    get: (target, prop) => Reflect.get(target, prop)
  })

  // getCurrentSub checking proxy
  const getCurrentSubProxy = new Proxy(baseObj, {
    get: (target, prop) => {
      getCurrentSub() // This is what storable does
      return Reflect.get(target, prop)
    }
  })

  // Full storable-style proxy (simplified)
  const fullProxy = new Proxy(baseObj, {
    get(target, prop) {
      if (prop === $RAW) return target
      const value = Reflect.get(target, prop)
      if (typeof value === 'function') return value
      if (!getCurrentSub()) return value
      const own = Object.prototype.hasOwnProperty.call(target, prop)
      return own ? value : value
    }
  })

  bench('Direct access: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += baseObj.count
    }
    // sum used to prevent optimization
  })

  bench('Minimal proxy: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += minimalProxy.count
    }
    // sum used to prevent optimization
  })

  bench('getCurrentSub proxy: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += getCurrentSubProxy.count
    }
    // sum used to prevent optimization
  })

  bench('Full storable proxy: 1M property reads', () => {
    let sum = 0
    for (let i = 0; i < 1_000_000; i++) {
      sum += fullProxy.count
    }
    // sum used to prevent optimization
  })
})

describe('Allocation Analysis: Signal Creation Patterns', () => {
  bench('Create 10k simple signals', () => {
    const signals = []
    for (let i = 0; i < 10_000; i++) {
      signals.push(signal(i))
    }
    // result used to prevent optimization
  })

  bench('Create 10k signals with $ setter', () => {
    const signals = []
    for (let i = 0; i < 10_000; i++) {
      const sig = signal(i) as any
      sig.$ = (v: any) => sig(v)
      signals.push(sig)
    }
    // result used to prevent optimization
  })

  bench('Create 10k signals via getNode pattern', () => {
    const nodes: Record<string, any> = Object.create(null)
    
    function getNode(property: string, value: any) {
      if (nodes[property]) return nodes[property]
      const newSignal = signal(value) as any
      newSignal.$ = (v: any) => newSignal(v)
      nodes[property] = newSignal
      // result used to prevent optimization
    }

    const signals = []
    for (let i = 0; i < 10_000; i++) {
      signals.push(getNode(`prop${i}`, i))
    }
    // result used to prevent optimization
  })
})

describe('Allocation Analysis: WeakMap Overhead', () => {
  const objects = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
  const cache = new WeakMap()
  
  // Pre-populate cache
  objects.forEach(obj => cache.set(obj, { cached: true }))

  bench('WeakMap.has: 100k calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      const obj = objects[i % 1000]
      if (obj) count += cache.has(obj) ? 1 : 0
    }
    // count used to prevent optimization
  })

  bench('WeakMap.get: 100k calls', () => {
    let count = 0
    for (let i = 0; i < 100_000; i++) {
      const obj = objects[i % 1000]
      if (obj) {
        const cached = cache.get(obj)
        count += cached ? 1 : 0
      }
    }
    // count used to prevent optimization
  })

  bench('WeakMap.set: 100k calls', () => {
    const newCache = new WeakMap()
    for (let i = 0; i < 100_000; i++) {
      const obj = objects[i % 1000]
      if (obj) newCache.set(obj, { id: i })
    }
    // cache used to prevent optimization
  })
})

describe('Allocation Analysis: Object Creation Patterns', () => {
  bench('Object.create(null): 100k calls', () => {
    const objects = []
    for (let i = 0; i < 100_000; i++) {
      objects.push(Object.create(null))
    }
    // result used to prevent optimization
  })

  bench('Plain object literal: 100k calls', () => {
    const objects = []
    for (let i = 0; i < 100_000; i++) {
      objects.push({})
    }
    // result used to prevent optimization
  })

  bench('Object.defineProperty: 100k calls', () => {
    const objects = []
    for (let i = 0; i < 100_000; i++) {
      const obj = {}
      Object.defineProperty(obj, 'value', { value: i, enumerable: false })
      objects.push(obj)
    }
    // result used to prevent optimization
  })

  bench('Multiple Object.defineProperty: 10k calls', () => {
    const objects = []
    for (let i = 0; i < 10_000; i++) {
      const obj = {}
      Object.defineProperty(obj, $NODE, { value: {}, enumerable: false })
      Object.defineProperty(obj, $VERSION, { value: 0, writable: true, enumerable: false })
      Object.defineProperty(obj, $RAW, { value: obj, enumerable: false })
      objects.push(obj)
    }
    // result used to prevent optimization
  })
})

describe('Allocation Analysis: Nested Proxy Creation', () => {
  const isWrappable = (value: unknown): value is object =>
    value !== null &&
    typeof value === 'object' &&
    (value.constructor === Object || value.constructor === Array)
  
  function createSimpleProxy<T extends object>(target: T): T {
    return new Proxy(target, {
      get: (target, prop) => Reflect.get(target, prop)
    }) as T
  }
  
  function wrap<T>(value: T, createProxy: (obj: any) => any): T {
    return isWrappable(value) ? createProxy(value) : value
  }

  bench('Direct nested access: 100k calls', () => {
    const data = { a: { b: { c: { value: 42 } } } }
    let sum = 0
    for (let i = 0; i < 100_000; i++) {
      sum += data.a.b.c.value
    }
    // sum used to prevent optimization
  })

  bench('Lazy proxy wrapping: 100k calls', () => {
    const baseData = { a: { b: { c: { value: 42 } } } }
    let sum = 0
    for (let i = 0; i < 100_000; i++) {
      const wrapped = wrap(baseData.a, createSimpleProxy)
      const wrapped2 = wrap((wrapped as any).b, createSimpleProxy)
      const wrapped3 = wrap((wrapped2 as any).c, createSimpleProxy)
      sum += (wrapped3 as any).value
    }
    // sum used to prevent optimization
  })
})