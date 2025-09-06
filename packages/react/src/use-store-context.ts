import {
  useRef,
  useEffect,
  useReducer,
  createContext,
  useContext,
  ReactNode,
  useLayoutEffect,
} from 'react'
import { effect, getCurrentSub, setCurrentSub } from '@storable/core'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

/**
 * Context to track the parent subscriber for proper isolation.
 * This allows nested components to restore the correct subscriber after rendering.
 */
const SubscriberContext = createContext<any>(null)

/**
 * Provider component that captures the current subscriber.
 * This is used internally to isolate tracking contexts.
 */
export function SubscriberProvider({ children }: { children: ReactNode }) {
  const currentSub = getCurrentSub()
  return (
    <SubscriberContext.Provider value={currentSub}>
      {children}
    </SubscriberContext.Provider>
  )
}

/**
 * React hook for using storable stores with proper nested component isolation.
 *
 * This implementation uses React Context to ensure that parent and child components
 * maintain separate tracking contexts, preventing interference between their
 * dependency tracking.
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
  // Get the parent subscriber from context (if any)
  const parentSub = useContext(SubscriberContext)

  // Force re-render when dependencies change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state
  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    prevSub: any
  }>()

  // Initialize on first render
  if (!stateRef.current) {
    // Capture whatever subscriber was active before us
    const prevSub = parentSub ?? getCurrentSub()

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
      prevSub,
    }
  }

  const state = stateRef.current

  // Update prevSub if context changed (e.g., parent component re-rendered)
  if (parentSub !== undefined) {
    state.prevSub = parentSub
  }

  // Set our effect as the current subscriber for this render
  // Storable's proxy will check getCurrentSub() when properties are accessed
  setCurrentSub(state.effectNode)

  // Restore the previous subscriber after this component renders
  // This is crucial for nested components
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
 * Alternative hook that returns a proxy to the store for cleaner usage.
 * The proxy ensures the correct subscriber is active during property access.
 *
 * This approach provides perfect isolation between nested components by
 * wrapping each property access to temporarily activate the correct effect.
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
  }>()

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

/**
 * HOC that wraps a component with a SubscriberProvider to isolate tracking contexts.
 * This can be used to ensure proper isolation in complex component trees.
 *
 * @example
 * ```tsx
 * const IsolatedComponent = withTrackedIsolation(MyComponent)
 * ```
 */
export function withTrackedIsolation<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return function IsolatedComponent(props: P) {
    const currentSub = getCurrentSub()
    return (
      <SubscriberContext.Provider value={currentSub}>
        <Component {...props} />
      </SubscriberContext.Provider>
    )
  }
}
