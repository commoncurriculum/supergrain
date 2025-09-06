import { useRef, useLayoutEffect, useEffect, useReducer } from 'react'
import { effect, getCurrentSub, setCurrentSub } from '@storable/core'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

/**
 * The simplest possible hook for using storable stores in React.
 *
 * Since storable's proxy already tracks dependencies when getCurrentSub()
 * returns an effect, we just need to:
 * 1. Create an effect that triggers re-renders
 * 2. Set it as current subscriber during our component's render
 * 3. Restore the previous subscriber after render
 *
 * @example
 * ```tsx
 * function Counter() {
 *   useStore() // Must be called first!
 *   return <div>{store.count}</div>
 * }
 * ```
 */
export function useStore(): void {
  // Force re-render when dependencies change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state
  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    prevSub: any
  } | null>(null)

  // Initialize on first render
  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    // Create an effect that will be notified when dependencies change
    const cleanup = effect(() => {
      // Capture the effect node on first run
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }

      // On subsequent runs, a dependency changed - trigger re-render
      forceUpdate()
    })

    stateRef.current = {
      cleanup,
      effectNode,
      prevSub: getCurrentSub(), // Save whatever was current before
    }
  }

  const state = stateRef.current

  // Set our effect as the current subscriber for this render
  // Storable's proxy will check getCurrentSub() when properties are accessed
  setCurrentSub(state.effectNode)

  // Restore the previous subscriber after this component renders
  // This prevents conflicts with nested components
  useIsomorphicLayoutEffect(() => {
    setCurrentSub(state.prevSub)
  })

  // Clean up when component unmounts
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
 * Alternative that returns the store for cleaner usage.
 * This requires passing the store as a parameter.
 *
 * This implementation uses a proxy to ensure the correct subscriber
 * is active during each property access, providing perfect isolation
 * for nested components.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const state = useTrackedStore(store)
 *   return <div>{state.count}</div>
 * }
 * ```
 */
export function useTrackedStore<T extends object>(store: T): T {
  // Force re-render when dependencies change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state and proxy
  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    proxy: T | null
  } | null>(null)

  // Initialize on first render
  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true

    // Create an effect that will be notified when dependencies change
    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })

    // Create a proxy that ensures our effect is current during property access
    // This is the key to proper nested component isolation
    const proxy = new Proxy(store, {
      get(target, prop, receiver) {
        // Save the current subscriber (might be another component's effect)
        const prevSub = getCurrentSub()

        // Set our effect as current for this property access
        // This ensures the dependency is tracked by the right component
        setCurrentSub(effectNode)

        try {
          // Access the property (this will establish the dependency)
          return Reflect.get(target, prop, receiver)
        } finally {
          // Restore the previous subscriber
          // This is crucial for nested components
          setCurrentSub(prevSub)
        }
      },
      set(target, prop, value, receiver) {
        return Reflect.set(target, prop, value, receiver)
      },
      has(target, prop) {
        return Reflect.has(target, prop)
      },
      deleteProperty(target, prop) {
        return Reflect.deleteProperty(target, prop)
      },
      ownKeys(target) {
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, prop) {
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    }) as T

    stateRef.current = {
      cleanup,
      effectNode,
      proxy,
    }
  }

  const state = stateRef.current

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      if (state.cleanup) {
        state.cleanup()
        state.cleanup = null
      }
    }
  }, [])

  return state.proxy!
}
