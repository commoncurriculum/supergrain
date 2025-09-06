import { useRef, useEffect } from 'react'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import { effect } from '@storable/core'

/**
 * Hook to use a reactive store in a React component.
 *
 * This hook automatically tracks which store properties are accessed during render
 * and subscribes the component to changes in those specific properties.
 *
 * @param store - The reactive store object to use
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
export function useStore<T extends object>(store: T): T {
  // Store reference to ensure we always use the latest store
  const storeRef = useRef<T>(store)
  storeRef.current = store

  // Create a stable store for React's subscription
  const reactiveStoreRef = useRef<{
    version: number
    listeners: Set<() => void>
    cleanup: (() => void) | null
    effectFn: (() => void) | null
  }>()

  if (!reactiveStoreRef.current) {
    reactiveStoreRef.current = {
      version: 0,
      listeners: new Set(),
      cleanup: null,
      effectFn: null,
    }
  }

  const reactiveStore = reactiveStoreRef.current

  // Subscribe function for useSyncExternalStore
  const subscribe = useRef((listener: () => void) => {
    reactiveStore.listeners.add(listener)

    // If this is the first listener, set up the effect
    if (reactiveStore.listeners.size ===
