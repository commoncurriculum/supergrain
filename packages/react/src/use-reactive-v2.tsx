import React, { useRef, useLayoutEffect, useEffect, useReducer } from 'react'
import { effect, getCurrentSub, setCurrentSub } from '@storable/core'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

/**
 * Hook that enables automatic tracking of store access in a React component.
 *
 * Instead of setting a global subscriber for the entire render, this version
 * returns a function that wraps store access to ensure proper tracking.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const track = useReactive()
 *
 *   // Wrap store access with track()
 *   const value = track(() => store.value)
 *
 *   return <div>{value}</div>
 * }
 * ```
 */
export function useReactive() {
  // Force re-render when stores change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state
  const effectRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    isTracking: boolean
  }>()

  // Initialize on first render
  if (!effectRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    // Create an effect that will be notified when dependencies change
    const cleanup = effect(() => {
      // On first run, capture the effect node
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }

      // On subsequent runs, a tracked dependency changed - trigger re-render
      forceUpdate()
    })

    effectRef.current = {
      cleanup,
      effectNode,
      isTracking: false,
    }
  }

  const state = effectRef.current

  // Clean up when component unmounts
  useLayoutEffect(() => {
    return () => {
      if (state.cleanup) {
        state.cleanup()
        state.cleanup = null
      }
    }
  }, [])

  // Return a function that wraps store access
  // This ensures each access is tracked by the correct effect
  const track = <T,>(accessor: () => T): T => {
    // Temporarily set our effect as current subscriber
    const prevSub = setCurrentSub(state.effectNode)
    try {
      // Access the store with our effect as current
      return accessor()
    } finally {
      // Always restore the previous subscriber
      setCurrentSub(prevSub)
    }
  }

  return track
}

/**
 * Alternative hook that automatically tracks all store access during render.
 * This version uses a Proxy to intercept property access.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const store = useTrackedStore(myStore)
 *   return <div>{store.value}</div> // Automatically tracked
 * }
 * ```
 */
export function useTrackedStore<T extends object>(store: T): T {
  const track = useReactive()

  // Create a proxy that tracks all property access
  const trackedStore = useRef<T>()

  if (!trackedStore.current) {
    trackedStore.current = new Proxy(store, {
      get(target, prop, receiver) {
        // Track this property access
        return track(() => Reflect.get(target, prop, receiver))
      },
      set(target, prop, value, receiver) {
        // For stores, we shouldn't allow direct mutation
        throw new Error(
          'Direct mutation of store state is not allowed. Use the update function.'
        )
      },
    })
  }

  return trackedStore.current
}

/**
 * Simple hook that just enables tracking for the entire component.
 * Must be called FIRST in the component, before any store access.
 *
 * This is a simpler API but has issues with nested components.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   useSimpleReactive() // Must be first!
 *   return <div>{store.value}</div>
 * }
 * ```
 */
export function useSimpleReactive(): void {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const effectRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    prevSub: any
  }>()

  if (!effectRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    // Save current subscriber
    const prevSub = getCurrentSub()

    // Create effect
    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })

    effectRef.current = {
      cleanup,
      effectNode,
      prevSub,
    }
  }

  const state = effectRef.current

  // Set our effect as current for this render
  setCurrentSub(state.effectNode)

  // Restore after render in the SAME phase to avoid conflicts
  // Using useLayoutEffect without dependencies runs after every render
  useIsomorphicLayoutEffect(() => {
    setCurrentSub(state.prevSub)
  })

  // Cleanup on unmount
  useLayoutEffect(() => {
    return () => {
      if (state.cleanup) {
        state.cleanup()
      }
    }
  }, [])
}

/**
 * HOC that wraps a component to enable automatic tracking.
 * This provides isolation between parent and child components.
 *
 * @example
 * ```tsx
 * const TrackedComponent = withReactive(MyComponent)
 * ```
 */
export function withReactive<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return function ReactiveComponent(props: P) {
    const track = useReactive()

    // Create a tracked props object
    const trackedProps = new Proxy(props, {
      get(target, prop) {
        return track(() => Reflect.get(target, prop))
      },
    })

    return <Component {...trackedProps} />
  }
}

/**
 * Component wrapper that provides a tracking context for its children.
 * This ensures proper isolation between components.
 *
 * @example
 * ```tsx
 * <Reactive>
 *   <MyComponent />
 * </Reactive>
 * ```
 */
export function Reactive({
  children,
  store,
}: {
  children: React.ReactNode
  store?: any
}) {
  const track = useReactive()

  // If a store is provided, make it available to children via context
  // This is optional - components can still access stores directly
  if (store) {
    const TrackedStoreContext = React.createContext(store)
    const trackedStore = new Proxy(store, {
      get(target, prop) {
        return track(() => Reflect.get(target, prop))
      },
    })

    return (
      <TrackedStoreContext.Provider value={trackedStore}>
        {children}
      </TrackedStoreContext.Provider>
    )
  }

  return <>{children}</>
}
