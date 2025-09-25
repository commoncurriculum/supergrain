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