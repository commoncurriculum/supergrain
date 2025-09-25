/**
 * Experimental Signal Object Pooling Implementation
 * 
 * This module provides an optional optimization for reducing GC pressure
 * in signal-heavy applications by reusing signal objects from a pool.
 * 
 * Performance benefits:
 * - Reduced GC pressure in hot paths
 * - Improved memory locality
 * - O(1) allocation/deallocation
 * 
 * Risks:
 * - Memory leaks if signals aren't properly released
 * - State contamination between reused signals
 * - Pool exhaustion under high load
 */

import { signal } from 'alien-signals'
import type { Signal } from '../store'

// Import Pool only if structurae is available (optional dependency)
let Pool: any = null
let structuraeAvailable = false

async function loadStructurae() {
  try {
    const structurae = await import('structurae')
    Pool = structurae.Pool
    structuraeAvailable = true
  } catch {
    // structurae not available, pooling disabled
    structuraeAvailable = false
  }
}

interface PooledSignal<T> extends Signal<T> {
  __poolIndex?: number
}

class SignalPoolManager {
  private pool: any = null
  private signalInstances: PooledSignal<any>[] = []
  private readonly DEFAULT_POOL_SIZE = 1000
  private enabled: boolean = false

  async initialize(size = 1000) {
    await loadStructurae()
    
    if (!Pool) {
      console.warn('Signal pooling disabled: structurae not available')
      return
    }

    try {
      this.pool = Pool.create(size)
      this.enabled = true
      this.initializePool(size)
    } catch (error) {
      console.warn('Failed to initialize signal pool:', error)
      this.enabled = false
    }
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
   * Get a pooled signal instance or create a new one if pool is disabled/exhausted
   */
  getSignal<T>(value?: T): PooledSignal<T> {
    if (!this.enabled || !this.pool) {
      // Fallback to regular allocation
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
    if (!this.enabled || !this.pool) {
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
    if (!this.enabled || !this.pool) {
      return { enabled: false, poolSize: 0, available: 0 }
    }

    // Count available slots
    let available = 0
    for (let i = 0; i < this.pool.length; i++) {
      // Count set bits in each 32-bit bucket
      let bucket = this.pool[i]
      while (bucket) {
        available += bucket & 1
        bucket >>>= 1
      }
    }

    return {
      enabled: true,
      poolSize: this.signalInstances.length,
      available,
      inUse: this.signalInstances.length - available
    }
  }
}

// Global singleton pool manager
let globalSignalPool: SignalPoolManager | null = null

/**
 * Initialize signal pooling with specified size
 */
export async function initializeSignalPool(size?: number): Promise<SignalPoolManager> {
  globalSignalPool = new SignalPoolManager()
  await globalSignalPool.initialize(size)
  return globalSignalPool
}

/**
 * Get a pooled signal (or regular signal if pooling disabled)
 */
export function getPooledSignal<T>(value?: T): PooledSignal<T> {
  if (!globalSignalPool) {
    globalSignalPool = new SignalPoolManager()
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
    return { enabled: false, poolSize: 0, available: 0 }
  }
  return globalSignalPool.getStats()
}

/**
 * Feature flag to enable/disable pooled signal creation in getNode()
 */
export const ENABLE_SIGNAL_POOLING = process.env.NODE_ENV !== 'production' 
  && typeof process !== 'undefined' 
  && process.env.STORABLE_SIGNAL_POOLING === 'true'