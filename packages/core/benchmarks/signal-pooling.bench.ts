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