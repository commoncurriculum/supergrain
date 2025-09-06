import { useRef, useLayoutEffect, useEffect, useReducer } from 'react'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import { effect, getCurrentSub, setCurrentSub } from '@storable/core'

const isServer = typeof window === 'undefined'
const useIsomorphicLayoutEffect = isServer ? useEffect : useLayoutEffect

interface EffectStore {
  effect: (() => void) | null
  effectNode: any
  version: number
  onStoreChange: (() => void) | null
  accessedProps: Set<string>
  prevSub: any
}

/**
 * Fixed version of useStore that properly tracks store property access during render.
 *
 * The key insight is that we need to:
 * 1. Create an effect to get a subscriber node
 * 2. Set that node as the current subscriber during render
 * 3. Let the component access store properties (establishing dependencies)
 * 4. Restore the previous subscriber after render
 * 5. The effect will be notified when dependencies change
 */
export function useStore<T extends object>(store: T): T {
  // Force re-render when store changes
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // Store our effect state in a ref
  const storeRef = useRef<EffectStore>()

  // Initialize the effect store on first render
  if (!storeRef.current) {
    let effectNode: any = null
    let version = 0

    // Create an effect that will be triggered when dependencies change
    const cleanup = effect(() => {
      // Capture the effect node on first run
      if (!effectNode) {
        effectNode = getCurrentSub()
      }

      // Increment version when dependencies change
      version = (version + 1) | 0

      // Notify React if we have a change handler
      const store = storeRef.current
      if (store && store.onStoreChange) {
        store.onStoreChange()
      }
    })

    storeRef.current = {
      effect: cleanup,
      effectNode,
      version,
      onStoreChange: null,
      accessedProps: new Set(),
      prevSub: null,
    }
  }

  const effectStore = storeRef.current

  // Subscribe to changes using useSyncExternalStore
  useSyncExternalStore(
    onStoreChange => {
      effectStore.onStoreChange = onStoreChange
      return () => {
        // Rotate version on unsubscribe to handle StrictMode
        effectStore.version = (effectStore.version + 1) | 0
        effectStore.onStoreChange = null
      }
    },
    () => effectStore.version,
    () => effectStore.version // Server snapshot
  )

  // Set our effect as the current subscriber during render
  // This is the key: store property access will now be tracked
  effectStore.prevSub = setCurrentSub(effectStore.effectNode)

  // Clean up after render completes
  useIsomorphicLayoutEffect(() => {
    // Restore the previous subscriber
    if (effectStore.prevSub !== undefined) {
      setCurrentSub(effectStore.prevSub)
      effectStore.prevSub = undefined
    }
  })

  // Clean up when component unmounts
  useLayoutEffect(() => {
    return () => {
      if (effectStore.effect) {
        effectStore.effect()
        effectStore.effect = null
      }
    }
  }, [])

  // Return the store - any property access will be tracked
  return store
}

/**
 * Alternative implementation that's more explicit about re-running
 * the effect to re-establish dependencies after each render.
 */
export function useStoreV2<T extends object>(store: T): T {
  const [version, setVersion] = useState(0)
  const effectRef = useRef<(() => void) | null>(null)
  const nodeRef = useRef<any>(null)

  // Clean up previous effect
  if (effectRef.current) {
    effectRef.current()
    effectRef.current = null
  }

  // Create new effect for this render
  effectRef.current = effect(() => {
    const node = getCurrentSub()

    // First run: capture the node
    if (!nodeRef.current) {
      nodeRef.current = node
      return
    }

    // Subsequent runs: trigger re-render
    setVersion(v => v + 1)
  })

  // Set as current subscriber during render
  const prevSub = setCurrentSub(nodeRef.current)

  // Restore after render
  useIsomorphicLayoutEffect(() => {
    setCurrentSub(prevSub)
  })

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (effectRef.current) {
        effectRef.current()
      }
    }
  }, [])

  return store
}

// Export the main implementation
export { useStore as useReactiveStore }
export { useStore as useObserver }
