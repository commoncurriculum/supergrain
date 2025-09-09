import { useRef, useLayoutEffect, useEffect, useReducer } from 'react'
import { effect, getCurrentSub, setCurrentSub } from '@storable/core'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

/**
 * Optimized version of useStore with minimal context switching overhead.
 *
 * Key optimization: Sets subscriber context once per render instead of per property access.
 * This eliminates the double-proxy wrapping and reduces context switching calls from
 * N (where N = number of property accesses) to just 2 per render.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   useOptimizedStore()
 *   return <div>{store.count}</div>
 * }
 * ```
 */
export function useOptimizedStore(): void {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    prevSub: any
  } | null>(null)

  // Initialize effect once
  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true
    const prevSub = getCurrentSub()

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })

    stateRef.current = {
      cleanup,
      effectNode,
      prevSub,
    }
  }

  const state = stateRef.current

  // Set context once per render (vs. per property access in original)
  setCurrentSub(state.effectNode)

  // Restore context after render
  useIsomorphicLayoutEffect(() => {
    setCurrentSub(state.prevSub)
  })

  // Cleanup
  useEffect(() => {
    return () => {
      if (state.cleanup) {
        state.cleanup()
        state.cleanup = null
      }
    }
  }, [])
}

/**
 * Optimized version of useTrackedStore with minimal context switching.
 *
 * Performance benefits over original useTrackedStore:
 * 1. No double-proxy creation (eliminates recursive proxy wrapping)
 * 2. No proxy cache management overhead
 * 3. Context switching reduced from N calls to 2 calls per render
 * 4. No per-property-access context save/restore operations
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const state = useOptimizedTrackedStore(store)
 *   return <div>{state.count}</div>
 * }
 * ```
 */
export function useOptimizedTrackedStore<T extends object>(store: T): T {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    prevSub: any
  } | null>(null)

  // Initialize effect once
  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true
    const prevSub = getCurrentSub()

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })

    stateRef.current = {
      cleanup,
      effectNode,
      prevSub,
    }
  }

  const state = stateRef.current

  // Single context switch per render instead of per property access
  setCurrentSub(state.effectNode)

  // Restore context after render
  useIsomorphicLayoutEffect(() => {
    setCurrentSub(state.prevSub)
  })

  // Cleanup
  useEffect(() => {
    return () => {
      if (state.cleanup) {
        state.cleanup()
        state.cleanup = null
      }
    }
  }, [])

  // Return store directly - alien-signals will track property accesses
  return store
}

/**
 * Performance comparison utility for measuring context switching overhead.
 * This demonstrates the difference between the approaches.
 */
export const performanceComparison = {
  /**
   * Original approach context switches per property access:
   *
   * Component accesses 5 properties = 15 context switches:
   * - 5x getCurrentSub() calls
   * - 5x setCurrentSub() calls
   * - 5x setCurrentSub(restore) calls
   */
  original: {
    contextSwitchesPerProperty: 3,
    contextSwitchesForNProperties: (n: number) => n * 3,
  },

  /**
   * Optimized approach context switches per render:
   *
   * Component accesses 5 properties = 2 context switches:
   * - 1x setCurrentSub() at render start
   * - 1x setCurrentSub(restore) after render
   */
  optimized: {
    contextSwitchesPerRender: 2,
    contextSwitchesForNProperties: () => 2, // Always 2, regardless of property count
  },

  /**
   * Calculate performance improvement ratio
   */
  getImprovementRatio(propertyCount: number): number {
    const original = propertyCount * 3
    const optimized = 2
    return original / optimized
  },
}

/**
 * Benchmark utility for testing context switching performance in practice.
 *
 * @example
 * ```tsx
 * // In a test file:
 * const benchmark = createContextSwitchBenchmark()
 *
 * function TestComponent({ useOriginal = false }) {
 *   const start = performance.now()
 *
 *   if (useOriginal) {
 *     const state = useTrackedStore(store)
 *     // Access many properties...
 *     const values = [state.a, state.b, state.c, state.d, state.e]
 *   } else {
 *     const state = useOptimizedTrackedStore(store)
 *     // Access same properties...
 *     const values = [state.a, state.b, state.c, state.d, state.e]
 *   }
 *
 *   benchmark.recordRenderTime(performance.now() - start)
 *   return <div>...</div>
 * }
 * ```
 */
export function createContextSwitchBenchmark() {
  const measurements: number[] = []

  return {
    recordRenderTime(time: number) {
      measurements.push(time)
    },

    getAverageTime(): number {
      return (
        measurements.reduce((sum, time) => sum + time, 0) / measurements.length
      )
    },

    getMedianTime(): number {
      const sorted = [...measurements].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2
    },

    reset() {
      measurements.length = 0
    },

    getResults() {
      return {
        count: measurements.length,
        average: this.getAverageTime(),
        median: this.getMedianTime(),
        min: Math.min(...measurements),
        max: Math.max(...measurements),
      }
    },
  }
}

/**
 * Expected performance improvements:
 *
 * 1. Context Switching Reduction:
 *    - 1 property access: 3 switches → 2 switches (1.5x improvement)
 *    - 5 property accesses: 15 switches → 2 switches (7.5x improvement)
 *    - 10 property accesses: 30 switches → 2 switches (15x improvement)
 *
 * 2. Eliminated Operations:
 *    - No recursive proxy creation
 *    - No proxy cache lookups
 *    - No per-access context save/restore
 *
 * 3. Memory Benefits:
 *    - Single proxy reference instead of proxy tree
 *    - No WeakMap cache overhead
 *    - Reduced garbage collection pressure
 *
 * The optimized approach should be particularly beneficial for:
 * - Components that access many store properties
 * - High-frequency rendering scenarios
 * - Complex nested object access patterns
 */
