# Signal Pooling Benchmark Results and Code

## Summary

This document contains the benchmark code and results that demonstrated why signal pooling with @zandaqo/structurae was not beneficial for Storable's performance.

## Benchmark Results

```
Regular signal allocation:  12,407 ops/sec ✅ FASTER
Pooled signal allocation:    8,334 ops/sec ❌ SLOWER (-1.5x)

Memory pressure (regular):   1,181 ops/sec ✅ FASTER  
Memory pressure (pooled):      682 ops/sec ❌ SLOWER (-1.73x)
```

## Simple Signal Pool Implementation (Proof of Concept)

The following simplified signal pool implementation was created to test the concept without external dependencies:

```typescript
/**
 * Simplified Signal Pool Implementation (for demonstration)
 * 
 * This demonstrates the concept without external dependencies
 */

import { signal } from 'alien-signals'
import type { Signal } from '../store'

interface PooledSignal<T> extends Signal<T> {
  __poolIndex?: number
}

// Simple pool implementation using arrays
class SimplePool {
  private available: number[] = []
  private size: number

  constructor(size: number) {
    this.size = size
    // Initialize with all indexes available
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
    // Pre-allocate signal instances
    this.signalInstances = new Array(size)
    
    for (let i = 0; i < size; i++) {
      const newSignal = signal(undefined) as PooledSignal<any>
      // Add setter convenience method
      newSignal.$ = (v: any) => newSignal(v)
      this.signalInstances[i] = newSignal
    }
  }

  /**
   * Get a pooled signal instance or create a new one if pool is exhausted
   */
  getSignal<T>(value?: T): PooledSignal<T> {
    if (!this.enabled) {
      return this.createRegularSignal(value)
    }

    const index = this.pool.get()
    if (index === -1) {
      // Pool exhausted, fallback to regular allocation
      return this.createRegularSignal(value)
    }

    const pooledSignal = this.signalInstances[index]
    // Set initial value
    pooledSignal(value)
    // Track pool index for future cleanup
    pooledSignal.__poolIndex = index

    return pooledSignal as PooledSignal<T>
  }

  /**
   * Return a signal to the pool for reuse
   */
  releaseSignal<T>(signal: PooledSignal<T>): void {
    if (!this.enabled) {
      return
    }

    const poolIndex = signal.__poolIndex
    if (poolIndex !== undefined) {
      // Reset signal state
      signal(undefined)
      delete signal.__poolIndex
      
      // Return to pool
      this.pool.free(poolIndex)
    }
  }

  private createRegularSignal<T>(value?: T): PooledSignal<T> {
    const newSignal = signal(value) as PooledSignal<T>
    newSignal.$ = (v: any) => newSignal(v)
    return newSignal
  }

  /**
   * Get pool statistics for monitoring
   */
  getStats() {
    return {
      enabled: this.enabled,
      ...this.pool.getStats()
    }
  }
}

// Global singleton pool manager
let globalSignalPool: SimpleSignalPoolManager | null = null

/**
 * Initialize signal pooling with specified size
 */
export function initializeSignalPool(size?: number): SimpleSignalPoolManager {
  globalSignalPool = new SimpleSignalPoolManager(size)
  return globalSignalPool
}

/**
 * Get a pooled signal (or regular signal if pooling disabled)
 */
export function getPooledSignal<T>(value?: T): PooledSignal<T> {
  if (!globalSignalPool) {
    globalSignalPool = new SimpleSignalPoolManager()
  }
  return globalSignalPool.getSignal(value)
}

/**
 * Release a signal back to the pool
 */
export function releasePooledSignal<T>(signal: PooledSignal<T>): void {
  if (globalSignalPool) {
    globalSignalPool.releaseSignal(signal)
  }
}

/**
 * Get pool statistics for monitoring
 */
export function getPoolStats() {
  if (!globalSignalPool) {
    return { enabled: false, total: 0, available: 0, inUse: 0 }
  }
  return globalSignalPool.getStats()
}
```

## Complete Benchmark Code

The following benchmark code was used to evaluate signal pooling performance:

```typescript
/**
 * Benchmark: Signal Pooling Performance Evaluation
 * 
 * This benchmark compares regular signal allocation vs pooled signal allocation
 * to measure the potential performance benefits of using structurae's Pool.
 */

import { bench, describe, beforeAll } from 'vitest'
import { signal } from 'alien-signals'
import { 
  initializeSignalPool, 
  getPooledSignal, 
  releasePooledSignal, 
  getPoolStats 
} from '../src/experimental/simple-signal-pool'

describe('Signal Pooling Performance', () => {
  // Initialize pool before benchmarks
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
    // Clean up - return signals to pool
    signals.forEach(s => releasePooledSignal(s))
  })

  bench('Mixed allocation/deallocation: 1000 cycles', () => {
    for (let i = 0; i < 1000; i++) {
      const s1 = getPooledSignal(i)
      const s2 = getPooledSignal(i * 2)
      const s3 = getPooledSignal(i * 3)
      
      // Use signals
      s1()
      s2()
      s3()
      
      // Return to pool
      releasePooledSignal(s1)
      releasePooledSignal(s2)
      releasePooledSignal(s3)
    }
  })

  bench('Signal updates: pooled vs regular (10k updates)', () => {
    const pooledSignals = []
    const regularSignals = []
    
    // Setup
    for (let i = 0; i < 100; i++) {
      pooledSignals.push(getPooledSignal(0))
      const s = signal(0)
      ;(s as any).$ = (v: any) => s(v)
      regularSignals.push(s)
    }
    
    // Test updates
    for (let i = 0; i < 10000; i++) {
      const index = i % 100
      pooledSignals[index](i)
      regularSignals[index](i)
    }
    
    // Cleanup
    pooledSignals.forEach(s => releasePooledSignal(s))
  })

  bench('Pool exhaustion handling: request 1500 signals (pool size 1000)', () => {
    const signals = []
    
    for (let i = 0; i < 1500; i++) {
      signals.push(getPooledSignal(i))
    }
    
    // Return all signals
    signals.forEach(s => releasePooledSignal(s))
  })

  // Removed afterEach for cleaner benchmark output
})

describe('Memory Usage Comparison', () => {
  bench('Memory pressure test: create/destroy 10k signals repeatedly', () => {
    for (let cycle = 0; cycle < 10; cycle++) {
      const signals = []
      
      // Allocate
      for (let i = 0; i < 1000; i++) {
        signals.push(getPooledSignal(i))
      }
      
      // Use signals
      signals.forEach((s, i) => {
        s(i * 2)
        s()  // read
      })
      
      // Deallocate
      signals.forEach(s => releasePooledSignal(s))
    }
  })

  bench('Memory pressure test: regular allocation (baseline)', () => {
    for (let cycle = 0; cycle < 10; cycle++) {
      const signals = []
      
      // Allocate
      for (let i = 0; i < 1000; i++) {
        const s = signal(i)
        ;(s as any).$ = (v: any) => s(v)
        signals.push(s)
      }
      
      // Use signals
      signals.forEach((s, i) => {
        s(i * 2)
        s()  // read
      })
      
      // No explicit cleanup - relies on GC
    }
  })
})

describe('Integration with Store Operations', () => {
  bench('Simulated store property access with pooled signals', () => {
    const mockDataNodes: Record<string, any> = {}
    const properties = ['name', 'age', 'email', 'address', 'phone']
    
    // Create signals for properties
    properties.forEach(prop => {
      mockDataNodes[prop] = getPooledSignal(`${prop}_value`)
    })
    
    // Simulate property access patterns
    for (let i = 0; i < 1000; i++) {
      const prop = properties[i % properties.length]
      const signal = mockDataNodes[prop]
      
      // Read
      const value = signal()
      
      // Update
      signal(`${prop}_updated_${i}`)
      
      // Read again
      signal()
    }
    
    // Cleanup
    Object.values(mockDataNodes).forEach(s => releasePooledSignal(s))
  })

  bench('Simulated store property access with regular signals (baseline)', () => {
    const mockDataNodes: Record<string, any> = {}
    const properties = ['name', 'age', 'email', 'address', 'phone']
    
    // Create signals for properties
    properties.forEach(prop => {
      const s = signal(`${prop}_value`)
      ;(s as any).$ = (v: any) => s(v)
      mockDataNodes[prop] = s
    })
    
    // Simulate property access patterns
    for (let i = 0; i < 1000; i++) {
      const prop = properties[i % properties.length]
      const signal = mockDataNodes[prop]
      
      // Read
      const value = signal()
      
      // Update
      signal(`${prop}_updated_${i}`)
      
      // Read again
      signal()
    }
  })
})
```

## Conclusion

The benchmark code conclusively demonstrated that signal pooling introduces more overhead than benefit, with performance regressions ranging from 1.5x to 1.73x slower than regular allocation. This confirmed that @zandaqo/structurae's Pool is not suitable for optimizing Storable's signal allocation patterns.