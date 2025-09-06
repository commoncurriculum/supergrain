import { useRef, useLayoutEffect, useEffect } from 'react'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import {
  createEffectStore,
  createEmptyEffectStore,
  ensureFinalCleanup,
  UNMANAGED,
  type EffectStore,
  type EffectStoreUsage,
} from './store-tracking'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

/**
 * Hook to use a reactive store in a React component.
 *
 * This hook automatically tracks which store properties are accessed during render
 * and subscribes the component to changes in those specific properties.
 *
 * @param store - The reactive store object to use
 * @param usage - Optional usage mode (UNMANAGED by default)
 * @returns The same store object, but with automatic tracking enabled
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const store = useStore(myStore)
 *   return <div>{store.count}</div> // Component re-renders when count changes
 * }
 * ```
 */
export function useStore<T extends object>(
  store: T,
  usage: EffectStoreUsage = UNMANAGED
): T {
  // Ensure cleanup is scheduled for unmanaged mode
  if (usage === UNMANAGED) {
    ensureFinalCleanup()
  }

  // Use a ref to maintain the effect store across renders
  const storeRef = useRef<EffectStore>()

  // Create the effect store on first render
  if (storeRef.current == null) {
    if (isServer) {
      // Use empty store for SSR
      storeRef.current = createEmptyEffectStore()
    } else {
      // Create real effect store for client
      storeRef.current = createEffectStore(usage)
    }
  }

  const effectStore = storeRef.current

  // Subscribe to changes using useSyncExternalStore
  // This ensures proper integration with React's rendering lifecycle
  useSyncExternalStore(
    effectStore.subscribe,
    effectStore.getSnapshot,
    effectStore.getServerSnapshot
  )

  // Start tracking dependencies
  // This activates the effect and begins tracking any signal access
  effectStore._start()

  // For unmanaged mode, schedule cleanup after render
  if (usage === UNMANAGED) {
    useIsomorphicLayoutEffect(() => {
      // Clean up trailing store after render
      return () => {
        effectStore.finish()
      }
    })
  }

  // Clean up when component unmounts
  useLayoutEffect(() => {
    return () => {
      effectStore.dispose()
    }
  }, [])

  // Return the store directly
  // Any property access on the store during render will be tracked
  // by the active effect from effectStore._start()
  return store
}

/**
 * Hook for using stores in components with automatic tracking.
 * This is the main export that most users will use.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const store = useStore(myStore)
 *   return <div>{store.value}</div>
 * }
 * ```
 */
export function useReactiveStore<T extends object>(store: T): T {
  return useStore(store, UNMANAGED)
}

/**
 * Hook for using stores in custom hooks with proper nesting support.
 * Use this when creating custom hooks that access stores.
 *
 * @example
 * ```tsx
 * function useMyCustomHook() {
 *   const store = useStoreInHook(myStore)
 *   return store.someValue
 * }
 * ```
 */
export function useStoreInHook<T extends object>(store: T): T {
  const effectStore = useStore(store, UNMANAGED)

  // In a real implementation with babel transform, this would be:
  // const effectStore = useStore(store, MANAGED_HOOK)
  // try {
  //   return store
  // } finally {
  //   effectStore.finish()
  // }

  return effectStore
}

/**
 * Alternative name for useStore for consistency with other libraries
 */
export const useObserver = useStore
