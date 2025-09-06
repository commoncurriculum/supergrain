import React, {
  useRef,
  useLayoutEffect,
  useEffect,
  useReducer,
  useState,
} from 'react'
import { effect, getCurrentSub, setCurrentSub } from '@storable/core'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

/**
 * Hook that enables automatic tracking of store access in a React component.
 *
 * MUST be called as the FIRST hook in your component, before any store access.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   useReactive() // MUST be first!
 *
 *   // Now any store access will be tracked
 *   return <div>{store.value}</div>
 * }
 * ```
 */
export function useReactive(): void {
  // Force re-render when stores change
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state
  const effectRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    isFirstRender: boolean
    prevSubscriber: any
  }>()

  // Initialize on first render
  if (!effectRef.current) {
    let isFirstRun = true
    let effectNode: any = null

    // Save the current subscriber before we create our effect
    const prevSub = getCurrentSub()

    // Create an effect that will be notified when dependencies change
    const cleanup = effect(() => {
      // On first run, capture the effect node
      if (isFirstRun) {
        effectNode = getCurrentSub() // Capture the node INSIDE the effect callback
        isFirstRun = false
        return
      }

      // On subsequent runs, a tracked dependency changed - trigger re-render
      forceUpdate()
    })

    effectRef.current = {
      cleanup,
      effectNode, // This will be set after the effect runs
      isFirstRender: true,
      prevSubscriber: prevSub,
    }
  }

  const state = effectRef.current

  // Set our effect as the current subscriber for this render
  // This is the key - any store access during render will be tracked by our effect
  setCurrentSub(state.effectNode)

  // Immediately restore the previous subscriber in a layout effect
  // This ensures nested components get their own tracking context
  useIsomorphicLayoutEffect(() => {
    // Restore previous subscriber after this component's render
    setCurrentSub(state.prevSubscriber)

    // Return a cleanup function that re-sets our effect when the component updates
    return () => {
      // Before the next render, set our effect as current again
      setCurrentSub(state.effectNode)
    }
  })

  // Handle first render flag
  useIsomorphicLayoutEffect(() => {
    if (state.isFirstRender) {
      state.isFirstRender = false
    }
  }, [])

  // Clean up when component unmounts
  useLayoutEffect(() => {
    return () => {
      if (state.cleanup) {
        state.cleanup()
        state.cleanup = null
      }
    }
  }, [])
}

/**
 * Alternative implementation that returns a tracking context
 * This allows more explicit control over what gets tracked
 */
export function useTrackingContext() {
  const [version, setVersion] = useState(0)
  const contextRef = useRef<{
    cleanup: (() => void) | null
    effectNode: any
    prevSub: any
    isTracking: boolean
  }>()

  if (!contextRef.current) {
    let effectNode: any = null

    const cleanup = effect(() => {
      if (!effectNode) {
        effectNode = getCurrentSub()
        return
      }
      // Dependency changed, trigger re-render
      setVersion(v => v + 1)
    })

    contextRef.current = {
      cleanup,
      effectNode,
      prevSub: null,
      isTracking: false,
    }
  }

  const context = contextRef.current

  const startTracking = () => {
    if (!context.isTracking) {
      context.prevSub = getCurrentSub()
      setCurrentSub(context.effectNode)
      context.isTracking = true
    }
  }

  const stopTracking = () => {
    if (context.isTracking) {
      setCurrentSub(context.prevSub)
      context.isTracking = false
    }
  }

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopTracking()
      if (context.cleanup) {
        context.cleanup()
      }
    }
  }, [])

  return { startTracking, stopTracking, version }
}

/**
 * HOC that wraps a component to enable automatic tracking
 */
export function withReactive<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return function ReactiveComponent(props: P) {
    useReactive()
    return <Component {...props} />
  }
}

/**
 * Component wrapper that enables tracking for its children
 */
export function Reactive({ children }: { children: React.ReactNode }) {
  useReactive()
  return <>{children}</>
}
