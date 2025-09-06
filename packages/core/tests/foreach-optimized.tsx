import React, { memo, useRef, useEffect, useState, useMemo } from 'react'
import { effect } from 'alien-signals'

// Symbol used by the store to access internal nodes
const $NODE = Symbol('store-node')
const $RAW = Symbol('store-raw')

// Get the raw unwrapped object from a proxy
function unwrap(value: any): any {
  return (value && value[$RAW]) || value
}

// Extract the existing signal for a specific property from the store
function getExistingSignal(
  target: any,
  property: string | number
): Signal<any> | null {
  const unwrappedTarget = unwrap(target)
  const nodes = unwrappedTarget?.[$NODE]
  return nodes?.[property] || null
}

// Hook to subscribe to a signal and trigger re-renders
function useSignal<T>(signal: () => T): T {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    // Subscribe to the signal
    const dispose = effect(() => {
      // Access the signal value to track it
      signal()
      // Trigger re-render
      setVersion(v => (v + 1) | 0)
    })

    return dispose
  }, [signal])

  // Return the current value
  return signal()
}

// Optimized ForEach component that uses existing store signals
interface ForEachProps<T> {
  each: T[]
  children: (item: T, index: number) => React.ReactNode
  fallback?: React.ReactNode
}

export function ForEach<T>({ each, children, fallback }: ForEachProps<T>) {
  if (!each || each.length === 0) {
    return <>{fallback}</>
  }

  // Pre-access all items to ensure signals are created
  each.forEach((item, index) => {
    const _ = each[index] // This triggers signal creation in the proxy
  })

  return (
    <>
      {each.map((_, index) => (
        <ForEachItem key={index} array={each} index={index}>
          {children}
        </ForEachItem>
      ))}
    </>
  )
}

// Individual item component that subscribes to its specific signal
interface ForEachItemProps<T> {
  array: T[]
  index: number
  children: (item: T, index: number) => React.ReactNode
}

const ForEachItem = memo(function ForEachItem<T>({
  array,
  index,
  children,
}: ForEachItemProps<T>) {
  // Get the signal for this specific index
  const signal = useMemo(() => {
    const sig = getExistingSignal(array, index)
    if (sig) return sig

    // Fallback: create a getter function if no signal exists
    return () => array[index]
  }, [array, index])

  // Subscribe to the signal
  const item = useSignal(signal as () => T)

  // Render the child with the current item
  return <>{children(item, index)}</>
})

// Keyed version for better handling of dynamic lists
interface KeyedForEachProps<T> {
  each: T[]
  keyBy: (item: T) => string | number
  children: (item: T, index: number) => React.ReactNode
  fallback?: React.ReactNode
}

export function KeyedForEach<T>({
  each,
  keyBy,
  children,
  fallback,
}: KeyedForEachProps<T>) {
  if (!each || each.length === 0) {
    return <>{fallback}</>
  }

  // Track items by key for stability
  const keyToIndex = useMemo(() => {
    const map = new Map<string | number, number>()
    each.forEach((item, index) => {
      map.set(keyBy(item), index)
    })
    return map
  }, [each, keyBy])

  return (
    <>
      {each.map((item, index) => {
        const key = keyBy(item)
        return (
          <KeyedForEachItem key={key} array={each} index={index} itemKey={key}>
            {children}
          </KeyedForEachItem>
        )
      })}
    </>
  )
}

const KeyedForEachItem = memo(function KeyedForEachItem<T>({
  array,
  index,
  itemKey,
  children,
}: {
  array: T[]
  index: number
  itemKey: string | number
  children: (item: T, index: number) => React.ReactNode
}) {
  // Get the signal for this specific index
  const signal = useMemo(() => {
    const sig = getExistingSignal(array, index)
    if (sig) return sig
    return () => array[index]
  }, [array, index])

  // Subscribe to the signal
  const item = useSignal(signal as () => T)

  return <>{children(item, index)}</>
})

// Simple wrapper that completely hides signals from children
export function SimpleForEach<T>({
  each,
  children,
  fallback,
}: {
  each: T[]
  children: (item: T, index: number) => React.ReactNode
  fallback?: React.ReactNode
}) {
  if (!each || each.length === 0) {
    return <>{fallback}</>
  }

  return (
    <>
      {each.map((_, index) => (
        <SimpleForEachItem key={index} array={each} index={index}>
          {children}
        </SimpleForEachItem>
      ))}
    </>
  )
}

const SimpleForEachItem = memo(function SimpleForEachItem<T>({
  array,
  index,
  children,
}: {
  array: T[]
  index: number
  children: (item: T, index: number) => React.ReactNode
}) {
  // Create a signal for this index
  const signal = useMemo(() => {
    // Try to get existing signal first
    const existing = getExistingSignal(array, index)
    if (existing) return existing

    // Otherwise create a getter
    return () => array[index]
  }, [])

  // Subscribe to changes
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const dispose = effect(() => {
      // Track the signal
      signal()
      // Trigger re-render on change
      setVersion(v => (v + 1) | 0)
    })

    return dispose
  }, [signal])

  // Get current value
  const item = signal()

  // Render child - it doesn't know about signals!
  return <>{children(item, index)}</>
})

// Export a hook for direct signal access when needed
export function useArrayItemSignal<T>(array: T[], index: number): T {
  const signal = useMemo(() => {
    const existing = getExistingSignal(array, index)
    if (existing) return existing
    return () => array[index]
  }, [array, index])

  return useSignal(signal as () => T)
}
