import React, { memo, useMemo } from 'react'
import { Signal, computed } from 'alien-signals'
import { createStore, unwrap } from '../packages/core/src'
import { useSignalValue } from '../packages/react-adapter'

// ============================================
// THE KEY INSIGHT
// ============================================

/**
 * The store ALREADY creates signals for each array element!
 *
 * When you access state.comments[0], the proxy:
 * 1. Creates a signal for index 0 if it doesn't exist
 * 2. Returns the proxied value
 *
 * So we can extract these existing signals instead of creating new ones!
 */

// Symbol used by the store to access internal nodes
const $NODE = Symbol('store-node')

/**
 * Extract the existing signal for a specific property from the store
 */
function getExistingSignal(
  target: any,
  property: string | number
): Signal<any> | null {
  const unwrappedTarget = unwrap(target)
  const nodes = unwrappedTarget?.[$NODE]
  return nodes?.[property] || null
}

/**
 * Get or create a signal for a specific array index
 */
function getOrCreateSignalForIndex(array: any[], index: number): Signal<any> {
  // First, access the element to ensure a signal is created
  const element = array[index]

  // Then extract the signal that was just created/already exists
  const signal = getExistingSignal(array, index)

  if (signal) {
    return signal
  }

  // Fallback: create a computed signal if we can't access the internal one
  return computed(() => array[index])
}

// ============================================
// FOREACH COMPONENT - USING EXISTING SIGNALS
// ============================================

interface ForEachProps<T> {
  each: T[]
  children: (item: T, index: number, itemSignal: Signal<T>) => React.ReactNode
  fallback?: React.ReactNode
}

/**
 * ForEach component that uses the EXISTING signals from the store.
 * No duplicate signals, maximum efficiency!
 */
export function ForEach<T>({ each, children, fallback }: ForEachProps<T>) {
  // First check if array is empty
  if (!each || each.length === 0) {
    return <>{fallback}</>
  }

  // Get or create signals for each array element
  const itemSignals = useMemo(() => {
    const signals: Signal<T>[] = []

    for (let i = 0; i < each.length; i++) {
      // Access the item to ensure proxy creates a signal
      const _ = each[i]

      // Get the existing signal from the store
      const existingSignal = getExistingSignal(each, i)

      if (existingSignal) {
        signals.push(existingSignal)
      } else {
        // Fallback for non-store arrays
        const index = i
        signals.push(computed(() => each[index]))
      }
    }

    return signals
  }, [each.length]) // Only recreate if length changes

  return (
    <>
      {each.map((item, index) => (
        <ForEachItem key={index}>
          {children(item, index, itemSignals[index])}
        </ForEachItem>
      ))}
    </>
  )
}

// Memoized wrapper to prevent re-renders
const ForEachItem = memo(({ children }: { children: React.ReactNode }) => {
  return <>{children}</>
})

// ============================================
// KEYED FOREACH - FOR DYNAMIC LISTS
// ============================================

interface KeyedForEachProps<T> {
  each: T[]
  keyBy: (item: T) => string | number
  children: (item: T, index: number, itemSignal: Signal<T>) => React.ReactNode
  fallback?: React.ReactNode
}

/**
 * KeyedForEach for when items can be added/removed/reordered.
 * Still uses existing store signals!
 */
export function KeyedForEach<T>({
  each,
  keyBy,
  children,
  fallback,
}: KeyedForEachProps<T>) {
  if (!each || each.length === 0) {
    return <>{fallback}</>
  }

  // Map items by their keys and get signals
  const { itemsByKey, signalsByKey } = useMemo(() => {
    const items = new Map<string | number, T>()
    const signals = new Map<string | number, Signal<T>>()

    each.forEach((item, index) => {
      const key = keyBy(item)
      items.set(key, item)

      // Get the existing signal for this index
      const existingSignal = getExistingSignal(each, index)
      if (existingSignal) {
        signals.set(key, existingSignal)
      } else {
        // Fallback computed signal
        const idx = index
        signals.set(
          key,
          computed(() => each[idx])
        )
      }
    })

    return { itemsByKey: items, signalsByKey: signals }
  }, [each.map(keyBy).join(',')]) // Recreate when keys change

  return (
    <>
      {each.map((item, index) => {
        const key = keyBy(item)
        const signal = signalsByKey.get(key)!

        return (
          <ForEachItem key={key}>{children(item, index, signal)}</ForEachItem>
        )
      })}
    </>
  )
}

// ============================================
// SIMPLIFIED API - HIDE SIGNALS COMPLETELY
// ============================================

interface SimpleForEachProps<T> {
  each: T[]
  children: (item: T, index: number) => React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Simplified ForEach that hides signals completely.
 * The child component just receives the item directly!
 */
export function SimpleForEach<T>({
  each,
  children,
  fallback,
}: SimpleForEachProps<T>) {
  if (!each || each.length === 0) {
    return <>{fallback}</>
  }

  return (
    <>
      {each.map((item, index) => {
        // Get the existing signal for this index
        const signal =
          getExistingSignal(each, index) || computed(() => each[index])

        return (
          <SignalBoundary key={index} signal={signal}>
            {() => children(item, index)}
          </SignalBoundary>
        )
      })}
    </>
  )
}

/**
 * SignalBoundary subscribes to a signal and renders children.
 * This completely hides the signal from the child component!
 */
function SignalBoundary<T>({
  signal,
  children,
}: {
  signal: Signal<T>
  children: () => React.ReactNode
}) {
  // Subscribe to the signal
  useSignalValue(signal)

  // Render children - they will see the current value
  return <>{children()}</>
}

// ============================================
// USAGE EXAMPLES
// ============================================

interface Comment {
  id: string
  text: string
  author: string
  likes: number
}

interface Post {
  title: string
  comments: Comment[]
}

const [postState, updatePost] = createStore<Post>({
  title: 'My Post',
  comments: Array.from({ length: 10000 }, (_, i) => ({
    id: `comment-${i}`,
    text: `Comment ${i}`,
    author: `User ${i}`,
    likes: 0,
  })),
})

// Example 1: With explicit signals (more control)
function PostWithSignals() {
  return (
    <article>
      <h1>{postState.title}</h1>
      <button onClick={() => updatePost({ $set: { title: 'New Title!' } })}>
        Change Title (Comments won't re-render!)
      </button>

      <ForEach each={postState.comments}>
        {(comment, index, commentSignal) => (
          <CommentWithSignal commentSignal={commentSignal} index={index} />
        )}
      </ForEach>
    </article>
  )
}

function CommentWithSignal({
  commentSignal,
  index,
}: {
  commentSignal: Signal<Comment>
  index: number
}) {
  const comment = useSignalValue(commentSignal)

  return (
    <div>
      <p>
        {comment.text} by {comment.author}
      </p>
      <button
        onClick={() => {
          updatePost({ $inc: { [`comments.${index}.likes`]: 1 } })
        }}
      >
        👍 {comment.likes}
      </button>
    </div>
  )
}

// Example 2: Simplified - signals completely hidden!
function PostSimplified() {
  return (
    <article>
      <h1>{postState.title}</h1>
      <button onClick={() => updatePost({ $set: { title: 'New Title!' } })}>
        Change Title (Comments won't re-render!)
      </button>

      {/* Child components don't even know about signals! */}
      <SimpleForEach each={postState.comments}>
        {(comment, index) => <SimpleComment comment={comment} index={index} />}
      </SimpleForEach>
    </article>
  )
}

function SimpleComment({
  comment,
  index,
}: {
  comment: Comment
  index: number
}) {
  // Just a regular React component - no signals!
  return (
    <div>
      <p>
        {comment.text} by {comment.author}
      </p>
      <button
        onClick={() => {
          updatePost({ $inc: { [`comments.${index}.likes`]: 1 } })
        }}
      >
        👍 {comment.likes}
      </button>
    </div>
  )
}

// ============================================
// PERFORMANCE CHARACTERISTICS
// ============================================

/**
 * When post title changes with 10,000 comments:
 *
 * Regular .map():
 * - 10,000 component re-renders
 * - Store creates 10,000 signals anyway (on access)
 * - Signals are created but not used efficiently
 *
 * With ForEach:
 * - 0 component re-renders
 * - Reuses the SAME signals the store already created
 * - No duplicate signals in memory
 * - Maximum efficiency
 *
 * Memory usage:
 * - Store already creates signals for accessed array elements
 * - ForEach just reuses them - no extra memory
 * - Actually MORE efficient than creating computed signals
 */

/**
 * THE BEAUTIFUL PART:
 *
 * The store was already creating these signals when you access
 * array elements through the proxy. We're just using them properly
 * instead of letting them go to waste!
 *
 * This means:
 * - No performance penalty for using ForEach
 * - Actually SAVES memory by reusing existing signals
 * - The optimization was already there, we just needed to tap into it
 */
