import { useRef, useLayoutEffect, useEffect } from 'react'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import {
  effect,
  setCurrentSub,
  getCurrentSub,
  startBatch,
  endBatch,
} from '@storable/core'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

/**
 * Hook that makes a React component reactive to signal/store changes.
 * This must be called at the top of any component that accesses reactive stores.
 *
 * The key is using setCurrentSub to make our effect the active subscriber
 * during the component's render phase, so store accesses get tracked.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   useSignals()
 *   return <div>{store.count}</div>
 * }
 * ```
 */
export function useSignals(): void {
  // Use a ref to maintain state across renders
  const storeRef = useRef<{
    cleanup: (() => void) | null
    version: number
    listeners: Set<() => void>
    effect: any // The alien-signals effect/subscriber node
  }>()

  // Initialize on first render
  if (!storeRef.current) {
    storeRef.current = {
      cleanup: null,
      version: 0,
      listeners: new Set(),
      effect: null,
    }
  }

  const store = storeRef.current

  // Subscribe function for useSyncExternalStore
  const subscribe = (listener: () => void) => {
    store.listeners.add(listener)
    return () => {
      store.listeners.delete(listener)
      // Rotate version on unsubscribe (for StrictMode)
      store.version = (store.version + 1) | 0
    }
  }

  // Get snapshot functions
  const getSnapshot = () => store.version
  const getServerSnapshot = () => store.version

  // Subscribe to changes using useSyncExternalStore
  // This ensures React re-renders when our version changes
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Clean up previous effect if it exists
  if (store.cleanup) {
    store.cleanup()
    store.cleanup = null
    store.effect = null
  }

  // Track if this is the first run of the effect
  let isFirstRun = true

  // Create the effect that will be notified of changes
  store.cleanup = effect(() => {
    if (!isFirstRun) {
      // A tracked dependency changed - trigger re-render
      startBatch()
      store.version = (store.version + 1) | 0
      store.listeners.forEach(listener => listener())
      endBatch()
    } else {
      // First run - just establishing the effect
      isFirstRun = false
    }
  })

  // Store the effect node (it's the return value's bound context)
  // The effect function returns a cleanup function, but the effect node
  // is what we need to set as the current subscriber
  store.effect = getCurrentSub()

  // CRITICAL: Set our effect as the current subscriber during render
  // This makes any store/signal access during render get tracked
  const prevSub = setCurrentSub(store.effect)

  // Clean up: restore the previous subscriber after render
  // We use useLayoutEffect with no deps so it runs after every render
  useLayoutEffect(() => {
    // Restore the previous subscriber
    setCurrentSub(prevSub)
  })

  // Clean up when component unmounts
  useLayoutEffect(() => {
    return () => {
      if (store.cleanup) {
        store.cleanup()
        store.cleanup = null
      }
      store.listeners.clear()
      store.effect = null
    }
  }, [])
}

/**
 * Hook for using a reactive store in a component.
 * This combines useSignals with returning the store for convenience.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const state = useStore(myStore)
 *   return <div>{state.count}</div>
 * }
 * ```
 */
export function useStore<T extends object>(store: T): T {
  useSignals()
  return store
}

/**
 * Alternative name for useStore
 */
export const useReactiveStore = useStore

/**
 * Hook that makes a component observe reactive values.
 * Alias for useSignals for those familiar with MobX patterns.
 */
export const observer = useSignals
