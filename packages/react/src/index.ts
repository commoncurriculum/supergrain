import { useRef, useMemo, useEffect, useLayoutEffect } from 'react'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import {
  createStore as createStorableStore,
  effect,
  computed,
  type Signal,
  type SetStoreFunction,
} from '@storable/core'

// Version-based effect store for tracking dependencies
interface EffectStore {
  subscribe: (onStoreChange: () => void) => () => void
  getSnapshot: () => number
  trackAccess: (fn: () => void) => void
}

function createEffectStore(): EffectStore {
  let version = 0
  let listeners = new Set<() => void>()
  let currentEffect: any = null
  let dispose: (() => void) | null = null

  const notifyListeners = () => {
    version = (version + 1) | 0 // 32-bit integer increment
    listeners.forEach(listener => listener())
  }

  return {
    subscribe(onStoreChange: () => void) {
      listeners.add(onStoreChange)
      return () => {
        listeners.delete(onStoreChange)
      }
    },

    getSnapshot() {
      return version
    },

    trackAccess(fn: () => void) {
      // Create an effect to track dependencies
      if (currentEffect) {
        dispose?.()
      }

      currentEffect = effect(() => {
        fn()
        // When dependencies change, notify React
        notifyListeners()
      })

      // Run the effect immediately to track initial dependencies
      fn()

      // Store dispose function for cleanup
      dispose = () => {
        if (currentEffect) {
          currentEffect()
          currentEffect = null
        }
      }
    },
  }
}

// Core hook: useStore
export function useStore<T extends object>(
  initialState: T
): [T, SetStoreFunction<T>] {
  // Create store only once
  const storeRef = useRef<[T, SetStoreFunction<T>] | null>(null)
  if (!storeRef.current) {
    storeRef.current = createStorableStore(initialState)
  }

  const [state, update] = storeRef.current

  // Create effect store for tracking
  const effectStore = useMemo(() => createEffectStore(), [])

  // Track which properties are accessed during render
  const accessedRef = useRef<() => void>(() => {})

  // Subscribe to changes
  const version = useSyncExternalStore(
    effectStore.subscribe,
    effectStore.getSnapshot,
    effectStore.getSnapshot
  )

  // Track property access during render
  useLayoutEffect(() => {
    effectStore.trackAccess(accessedRef.current)

    return () => {
      // Cleanup on unmount
      effectStore.trackAccess(() => {})
    }
  }, [version, effectStore])

  // Capture accessed properties for this render
  accessedRef.current = () => {
    // Access state to track dependencies
    // This is a placeholder - actual tracking happens via proxy
    JSON.stringify(state)
  }

  return [state, update]
}

// Global store subscription hook
export function useStoreValue<T extends object, R = T>(
  state: T,
  selector?: (state: T) => R
): R {
  const effectStore = useMemo(() => createEffectStore(), [])

  // Track what we access
  const valueRef = useRef<R>()
  const accessedRef = useRef<() => R>(() => {
    return selector ? selector(state) : (state as unknown as R)
  })

  // Subscribe to changes
  const version = useSyncExternalStore(
    effectStore.subscribe,
    effectStore.getSnapshot,
    effectStore.getSnapshot
  )

  // Track property access and compute value
  useLayoutEffect(() => {
    effectStore.trackAccess(() => {
      valueRef.current = accessedRef.current()
    })

    return () => {
      effectStore.trackAccess(() => {})
    }
  }, [version, effectStore])

  // Update accessed function for this render
  accessedRef.current = () => {
    return selector ? selector(state) : (state as unknown as R)
  }

  // Compute value for this render
  valueRef.current = accessedRef.current()

  return valueRef.current
}

// Derived state hook
export function useDerived<T>(fn: () => T): T {
  const computedRef = useRef<Signal<T> | null>(null)
  const effectStore = useMemo(() => createEffectStore(), [])

  // Create computed signal only once
  if (!computedRef.current) {
    computedRef.current = computed(fn)
  }

  // Subscribe to changes
  const version = useSyncExternalStore(
    effectStore.subscribe,
    effectStore.getSnapshot,
    effectStore.getSnapshot
  )

  // Track the computed value
  const valueRef = useRef<T>(computedRef.current.value)

  useLayoutEffect(() => {
    effectStore.trackAccess(() => {
      valueRef.current = computedRef.current!.value
    })

    return () => {
      effectStore.trackAccess(() => {})
    }
  }, [version, effectStore])

  return computedRef.current.value
}

// Alias for consistency with naming
export const useComputed = useDerived

// Store effect hook
export function useStoreEffect(fn: () => void | (() => void)): void {
  const cleanupRef = useRef<(() => void) | void>(undefined)
  const disposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Create an effect that will track dependencies
    disposeRef.current = effect(() => {
      // Clean up previous effect if it exists
      if (cleanupRef.current && typeof cleanupRef.current === 'function') {
        cleanupRef.current()
      }
      // Run the effect and store cleanup
      cleanupRef.current = fn()
    })

    // Cleanup on unmount
    return () => {
      if (disposeRef.current) {
        disposeRef.current()
      }
      if (cleanupRef.current && typeof cleanupRef.current === 'function') {
        cleanupRef.current()
      }
    }
  }, []) // Empty deps array - the effect handles its own dependencies
}

// Hook for using raw signals
export function useSignalValue<T>(sig: Signal<T>): T {
  const effectStore = useMemo(() => createEffectStore(), [])

  // Subscribe to changes
  const version = useSyncExternalStore(
    effectStore.subscribe,
    effectStore.getSnapshot,
    effectStore.getSnapshot
  )

  const valueRef = useRef<T>(sig.value)

  useLayoutEffect(() => {
    effectStore.trackAccess(() => {
      valueRef.current = sig.value
    })

    return () => {
      effectStore.trackAccess(() => {})
    }
  }, [version, effectStore, sig])

  return sig.value
}

// Utility to get signal from a proxied state path
export function getSignal<T extends object>(
  state: T,
  path: string | number
): Signal<any> | undefined {
  // This is a simplified implementation
  // In a real implementation, we'd need to traverse the proxy
  // and extract the underlying signal
  const parts = typeof path === 'string' ? path.split('.') : [path]
  let current: any = state

  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = current[part]
    } else {
      return undefined
    }
  }

  // In practice, we'd need to access the internal signal
  // This would require exposing it from the core library
  return current?.__signal
}

// ForEach component for optimized list rendering
interface ForEachProps<T> {
  each: T[]
  children: (item: T, index: number) => React.ReactNode
}

export function ForEach<T>({ each, children }: ForEachProps<T>) {
  const effectStore = useMemo(() => createEffectStore(), [])

  // Subscribe to changes
  const version = useSyncExternalStore(
    effectStore.subscribe,
    effectStore.getSnapshot,
    effectStore.getSnapshot
  )

  const itemsRef = useRef<T[]>(each)

  useLayoutEffect(() => {
    effectStore.trackAccess(() => {
      // Track array access
      itemsRef.current = [...each]
    })

    return () => {
      effectStore.trackAccess(() => {})
    }
  }, [version, effectStore, each])

  // Render children with items
  return (
    <>
      {each.map((item, index) => children(item, index))}
    </>
  )
}

// Re-export createStore for convenience
export { createStore } from '@storable/core'

// Export types
export type { Signal, SetStoreFunction } from '@storable/core'
