# Signal Pooling Benchmark

> **Status:** COMPLETED -- pooling rejected
> **Outcome:** Signal pooling is 1.5-1.73x SLOWER than regular allocation in all scenarios tested.
> **Conclusion:** Pool management overhead exceeds allocation savings. V8's GC handles signal allocation efficiently; pooling adds unnecessary indirection.

---

## Benchmark Results

```
Regular signal allocation:  12,407 ops/sec  FASTER
Pooled signal allocation:    8,334 ops/sec  SLOWER (-1.5x)

Memory pressure (regular):   1,181 ops/sec  FASTER
Memory pressure (pooled):      682 ops/sec  SLOWER (-1.73x)
```

Pooling lost in every scenario: allocation, deallocation, memory pressure, and mixed workloads.

---

## Proof-of-Concept Pool Implementation

A simplified signal pool was built to test the concept without external dependencies (structurae):

```typescript
import { signal } from 'alien-signals'
import type { Signal } from '../store'

interface PooledSignal<T> extends Signal<T> {
  __poolIndex?: number
}

class SimplePool {
  private available: number[] = []
  private size: number

  constructor(size: number) {
    this.size = size
    for (let i = 0; i < size; i++) {
      this.available.push(i)
    }
  }

  get(): number {
    return this.available.pop() ?? -1
  }

  free(index: number): void {
    if (index >= 0 && index < this.size) {
      this.available.push(index)
    }
  }

  getStats() {
    return {
      total: this.size,
      available: this.available.length,
      inUse: this.size - this.available.length
    }
  }
}

class SimpleSignalPoolManager {
  private pool: SimplePool
  private signalInstances: PooledSignal<any>[] = []
  private enabled: boolean = true

  constructor(size = 1000) {
    this.pool = new SimplePool(size)
    this.initializePool(size)
  }

  private initializePool(size: number) {
    this.signalInstances = new Array(size)
    for (let i = 0; i < size; i++) {
      const newSignal = signal(undefined) as PooledSignal<any>
      newSignal.$ = (v: any) => newSignal(v)
      this.signalInstances[i] = newSignal
    }
  }

  getSignal<T>(value?: T): PooledSignal<T> {
    if (!this.enabled) return this.createRegularSignal(value)

    const index = this.pool.get()
    if (index === -1) return this.createRegularSignal(value) // Pool exhausted

    const pooledSignal = this.signalInstances[index]
    pooledSignal(value)
    pooledSignal.__poolIndex = index
    return pooledSignal as PooledSignal<T>
  }

  releaseSignal<T>(signal: PooledSignal<T>): void {
    if (!this.enabled) return
    const poolIndex = signal.__poolIndex
    if (poolIndex !== undefined) {
      signal(undefined)
      delete signal.__poolIndex
      this.pool.free(poolIndex)
    }
  }

  private createRegularSignal<T>(value?: T): PooledSignal<T> {
    const newSignal = signal(value) as PooledSignal<T>
    newSignal.$ = (v: any) => newSignal(v)
    return newSignal
  }

  getStats() {
    return { enabled: this.enabled, ...this.pool.getStats() }
  }
}

// Exports for benchmark use
let globalSignalPool: SimpleSignalPoolManager | null = null

export function initializeSignalPool(size?: number): SimpleSignalPoolManager {
  globalSignalPool = new SimpleSignalPoolManager(size)
  return globalSignalPool
}

export function getPooledSignal<T>(value?: T): PooledSignal<T> {
  if (!globalSignalPool) globalSignalPool = new SimpleSignalPoolManager()
  return globalSignalPool.getSignal(value)
}

export function releasePooledSignal<T>(signal: PooledSignal<T>): void {
  if (globalSignalPool) globalSignalPool.releaseSignal(signal)
}

export function getPoolStats() {
  if (!globalSignalPool) return { enabled: false, total: 0, available: 0, inUse: 0 }
  return globalSignalPool.getStats()
}
```

---

## Benchmark Code

```typescript
import { bench, describe, beforeAll } from 'vitest'
import { signal } from 'alien-signals'
import {
  initializeSignalPool,
  getPooledSignal,
  releasePooledSignal,
  getPoolStats
} from '../src/experimental/simple-signal-pool'

describe('Signal Pooling Performance', () => {
  beforeAll(() => {
    initializeSignalPool(1000)
  })

  bench('Regular signal allocation: create 1000 signals', () => {
    const signals = []
    for (let i = 0; i < 1000; i++) {
      const s = signal(i)
      ;(s as any).$ = (v: any) => s(v)
      signals.push(s)
    }
  })

  bench('Pooled signal allocation: get 1000 signals from pool', () => {
    const signals = []
    for (let i = 0; i < 1000; i++) {
      const s = getPooledSignal(i)
      signals.push(s)
    }
    signals.forEach(s => releasePooledSignal(s))
  })

  bench('Mixed allocation/deallocation: 1000 cycles', () => {
    for (let i = 0; i < 1000; i++) {
      const s1 = getPooledSignal(i)
      const s2 = getPooledSignal(i * 2)
      const s3 = getPooledSignal(i * 3)
      s1(); s2(); s3()
      releasePooledSignal(s1)
      releasePooledSignal(s2)
      releasePooledSignal(s3)
    }
  })

  bench('Signal updates: pooled vs regular (10k updates)', () => {
    const pooledSignals = []
    const regularSignals = []
    for (let i = 0; i < 100; i++) {
      pooledSignals.push(getPooledSignal(0))
      const s = signal(0)
      ;(s as any).$ = (v: any) => s(v)
      regularSignals.push(s)
    }
    for (let i = 0; i < 10000; i++) {
      const index = i % 100
      pooledSignals[index](i)
      regularSignals[index](i)
    }
    pooledSignals.forEach(s => releasePooledSignal(s))
  })

  bench('Pool exhaustion handling: request 1500 signals (pool size 1000)', () => {
    const signals = []
    for (let i = 0; i < 1500; i++) {
      signals.push(getPooledSignal(i))
    }
    signals.forEach(s => releasePooledSignal(s))
  })
})

describe('Memory Usage Comparison', () => {
  bench('Memory pressure test: create/destroy 10k signals repeatedly', () => {
    for (let cycle = 0; cycle < 10; cycle++) {
      const signals = []
      for (let i = 0; i < 1000; i++) signals.push(getPooledSignal(i))
      signals.forEach((s, i) => { s(i * 2); s() })
      signals.forEach(s => releasePooledSignal(s))
    }
  })

  bench('Memory pressure test: regular allocation (baseline)', () => {
    for (let cycle = 0; cycle < 10; cycle++) {
      const signals = []
      for (let i = 0; i < 1000; i++) {
        const s = signal(i)
        ;(s as any).$ = (v: any) => s(v)
        signals.push(s)
      }
      signals.forEach((s, i) => { s(i * 2); s() })
    }
  })
})

describe('Integration with Store Operations', () => {
  bench('Simulated store property access with pooled signals', () => {
    const mockDataNodes: Record<string, any> = {}
    const properties = ['name', 'age', 'email', 'address', 'phone']
    properties.forEach(prop => {
      mockDataNodes[prop] = getPooledSignal(`${prop}_value`)
    })
    for (let i = 0; i < 1000; i++) {
      const prop = properties[i % properties.length]
      const signal = mockDataNodes[prop]
      signal()
      signal(`${prop}_updated_${i}`)
      signal()
    }
    Object.values(mockDataNodes).forEach(s => releasePooledSignal(s))
  })

  bench('Simulated store property access with regular signals (baseline)', () => {
    const mockDataNodes: Record<string, any> = {}
    const properties = ['name', 'age', 'email', 'address', 'phone']
    properties.forEach(prop => {
      const s = signal(`${prop}_value`)
      ;(s as any).$ = (v: any) => s(v)
      mockDataNodes[prop] = s
    })
    for (let i = 0; i < 1000; i++) {
      const prop = properties[i % properties.length]
      const signal = mockDataNodes[prop]
      signal()
      signal(`${prop}_updated_${i}`)
      signal()
    }
  })
})
```
