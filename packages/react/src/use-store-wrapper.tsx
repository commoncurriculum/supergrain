import { useRef, useEffect, useReducer } from 'react'
import { effect, getCurrentSub, setCurrentSub } from '@storable/core'

// Global stack to manage nested component subscribers
const subscriberStack: any[] = []

/**
 * Push a subscriber onto the stack and set it as current
 */
function pushSubscriber(subscriber: any) {
  const current = getCurrentSub()
  subscriberStack.push(current)
  setCurrentSub(subscriber)
  return current
}

/**
 * Pop a subscriber from the stack and restore the previous one
 */
function popSubscriber() {
  if (subscriberStack.length > 0) {
    const prev = subscriberStack.pop()
    setCurrentSub(prev)
    return prev
  }
  return null
}

/**
 * React hook for using storable stores with proper nested component isolation.
 *
 * This implementation uses a global subscriber stack to manage nested component
 * tracking contexts. Each component pushes its subscriber when rendering and
 * pops it when done, ensuring proper isolation.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const store = useStoreWrapper(myStore)
 *   return <div>{store.count}</div>
 * }
 * ```
 */
export function useStoreWrapper<T extends object>(store: T): T {
  // Force re-render when dependencies change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state and wrapped store
  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    wrappedStore: T | null
  }>()

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

    // Create a wrapped store that manages the subscriber stack
    const wrappedStore = new Proxy(store, {
      get(target, prop, receiver) {
        // Push our effect onto the stack for this property access
        pushSubscriber(effectNode)

        try {
          // Access the property (this will establish the dependency)
          return Reflect.get(target, prop, receiver)
        } finally {
          // Pop the stack to restore the previous subscriber
          popSubscriber()
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
      wrappedStore,
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

  return state.wrappedStore!
}

/**
 * Simple hook that just sets up tracking without returning anything.
 * Must be called before accessing the store.
 *
 * @deprecated Use useStoreWrapper instead for better nested component support
 */
export function useSimpleStore(): void {
  // Force re-render when dependencies change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state
  const stateRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
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

    stateRef.current = {
      cleanup,
      effectNode,
    }
  }

  const state = stateRef.current

  // Set our effect as the current subscriber for this render
  // Note: This approach has issues with nested components
  setCurrentSub(state.effectNode)

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
