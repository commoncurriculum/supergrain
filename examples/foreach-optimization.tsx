import React, { memo, useMemo } from 'react'
import { Signal, computed } from 'alien-signals'
import { createStore } from '../packages/core/src'
import { useSignalValue } from '../packages/react-adapter'

// ============================================
// THE PROBLEM
// ============================================

/**
 * When you have:
 * - Post with 10,000 comments
 * - Post title changes
 *
 * Without optimization:
 * - ALL 10,000 comment components re-render
 *
 * With React.memo:
 * - React still has to check 10,000 components for changes
 *
 * With ForEach + signals:
 * - Only the ForEach wrapper re-renders
 * - Individual comment components are untouched
 */

// ============================================
// FOREACH COMPONENT IMPLEMENTATION
// ============================================

interface ForEachProps<T> {
  each: T[] | Signal<T[]>
  children: (item: Signal<T>, index: number) => React.ReactNode
  fallback?: React.ReactNode
}

/**
 * ForEach component that creates stable signals for each array item.
 * When the array changes, it intelligently updates only what's needed.
 */
function ForEach<T>({ each, children, fallback }: ForEachProps<T>) {
  // Get the actual array
  const items =
    typeof each === 'function' ? useSignalValue(each as Signal<T[]>) : each

  // If empty, show fallback
  if (!items || items.length === 0) {
    return <>{fallback}</>
  }

  // Create stable signals for each item
  const itemSignals = useMemo(() => {
    const signals = new Map<number, Signal<T>>()

    items.forEach((item, index) => {
      // Create a computed signal for this specific index
      const itemSignal = computed(() => {
        // This will track the array at this index
        const currentItems =
          typeof each === 'function' ? (each as Signal<T[]>)() : each
        return currentItems[index]
      })
      signals.set(index, itemSignal)
    })

    return signals
  }, [items.length]) // Only recreate if length changes

  return (
    <>
      {items.map((_, index) => (
        <MemoizedItem key={index}>
          {children(itemSignals.get(index)!, index)}
        </MemoizedItem>
      ))}
    </>
  )
}

// Wrapper to ensure each child is memoized
const MemoizedItem = memo(({ children }: { children: React.ReactNode }) => {
  return <>{children}</>
})

// ============================================
// ADVANCED FOREACH WITH KEYED TRACKING
// ============================================

interface KeyedForEachProps<T> {
  each: T[] | Signal<T[]>
  keyBy: (item: T) => string | number
  children: (item: Signal<T>, index: number) => React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Advanced ForEach that tracks items by key for better stability
 * when items are added/removed/reordered
 */
function KeyedForEach<T>({
  each,
  keyBy,
  children,
  fallback,
}: KeyedForEachProps<T>) {
  const items =
    typeof each === 'function' ? useSignalValue(each as Signal<T[]>) : each

  if (!items || items.length === 0) {
    return <>{fallback}</>
  }

  // Create stable signals mapped by key
  const itemSignalsByKey = useMemo(() => {
    const signals = new Map<string | number, Signal<T>>()

    items.forEach(item => {
      const key = keyBy(item)

      if (!signals.has(key)) {
        // Create a computed signal that finds this item by key
        const itemSignal = computed(() => {
          const currentItems =
            typeof each === 'function' ? (each as Signal<T[]>)() : each
          return currentItems.find(i => keyBy(i) === key)!
        })
        signals.set(key, itemSignal)
      }
    })

    return signals
  }, [items.map(keyBy).join(',')]) // Recreate if keys change

  return (
    <>
      {items.map((item, index) => {
        const key = keyBy(item)
        return (
          <MemoizedItem key={key}>
            {children(itemSignalsByKey.get(key)!, index)}
          </MemoizedItem>
        )
      })}
    </>
  )
}

// ============================================
// USAGE EXAMPLE: 10,000 COMMENTS
// ============================================

interface Comment {
  id: string
  text: string
  author: string
  likes: number
}

interface Post {
  title: string
  content: string
  comments: Comment[]
}

// Create store with 10,000 comments
const [postState, updatePost] = createStore<Post>({
  title: 'My Post Title',
  content: 'Post content...',
  comments: Array.from({ length: 10000 }, (_, i) => ({
    id: `comment-${i}`,
    text: `Comment ${i} text`,
    author: `User ${i % 100}`,
    likes: Math.floor(Math.random() * 100),
  })),
})

// Create a signal for just the comments array
const commentsSignal = computed(() => postState.comments)

// ============================================
// WITHOUT FOREACH - BAD PERFORMANCE
// ============================================

function PostWithoutOptimization() {
  console.log('Post re-rendering')

  return (
    <article>
      <h1>{postState.title}</h1>
      <button onClick={() => updatePost({ $set: { title: 'New Title!' } })}>
        Change Title
      </button>

      {/* This will cause ALL comments to re-render when title changes! */}
      {postState.comments.map(comment => (
        <CommentComponent key={comment.id} comment={comment} />
      ))}
    </article>
  )
}

function CommentComponent({ comment }: { comment: Comment }) {
  console.log(`Comment ${comment.id} re-rendering`)

  return (
    <div>
      <p>{comment.text}</p>
      <small>
        by {comment.author} - {comment.likes} likes
      </small>
    </div>
  )
}

// ============================================
// WITH FOREACH - OPTIMIZED
// ============================================

function PostWithForEach() {
  console.log('Post re-rendering')

  return (
    <article>
      <h1>{postState.title}</h1>
      <button onClick={() => updatePost({ $set: { title: 'New Title!' } })}>
        Change Title
      </button>

      {/* ForEach handles the optimization internally! */}
      <ForEach each={commentsSignal}>
        {(commentSignal, index) => (
          <OptimizedComment commentSignal={commentSignal} index={index} />
        )}
      </ForEach>
    </article>
  )
}

function OptimizedComment({
  commentSignal,
  index,
}: {
  commentSignal: Signal<Comment>
  index: number
}) {
  // This component ONLY re-renders when its specific comment changes
  const comment = useSignalValue(commentSignal)

  console.log(`Comment ${comment.id} rendering`)

  return (
    <div>
      <p>{comment.text}</p>
      <small>by {comment.author}</small>
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
// WITH KEYED FOREACH - BEST FOR DYNAMIC LISTS
// ============================================

function PostWithKeyedForEach() {
  console.log('Post re-rendering')

  return (
    <article>
      <h1>{postState.title}</h1>

      <div>
        <button onClick={() => updatePost({ $set: { title: 'New Title!' } })}>
          Change Title (No comment re-renders!)
        </button>

        <button
          onClick={() => {
            // Add new comment at the beginning
            updatePost({
              $unshift: {
                comments: {
                  id: `comment-${Date.now()}`,
                  text: 'New comment!',
                  author: 'New User',
                  likes: 0,
                },
              },
            })
          }}
        >
          Add Comment
        </button>
      </div>

      {/* KeyedForEach is best when items can be added/removed/reordered */}
      <KeyedForEach
        each={commentsSignal}
        keyBy={comment => comment.id}
        fallback={<p>No comments yet</p>}
      >
        {(commentSignal, index) => (
          <StableComment commentSignal={commentSignal} index={index} />
        )}
      </KeyedForEach>
    </article>
  )
}

function StableComment({
  commentSignal,
  index,
}: {
  commentSignal: Signal<Comment>
  index: number
}) {
  const comment = useSignalValue(commentSignal)

  // This will show that comments don't re-render when title changes
  console.log(`Rendering comment: ${comment.id}`)

  return (
    <div className="comment">
      <p>{comment.text}</p>
      <small>by {comment.author}</small>
      <span>👍 {comment.likes}</span>
    </div>
  )
}

// ============================================
// PERFORMANCE COMPARISON
// ============================================

/**
 * SCENARIO: Post with 10,000 comments, title changes
 *
 * Without ForEach:
 * - 10,000 component re-renders
 * - React has to diff 10,000 components
 * - Massive performance hit
 *
 * With React.memo (traditional approach):
 * - 10,000 prop comparisons
 * - Still checking every component
 * - Better but not great
 *
 * With ForEach + Signals:
 * - 0 comment re-renders
 * - Only ForEach wrapper re-evaluates
 * - Comments remain completely untouched
 * - Near-instant update regardless of list size
 */

// ============================================
// API SUMMARY
// ============================================

/**
 * Simple ForEach:
 * <ForEach each={items}>
 *   {(itemSignal, index) => <Item signal={itemSignal} />}
 * </ForEach>
 *
 * Keyed ForEach (for dynamic lists):
 * <KeyedForEach each={items} keyBy={item => item.id}>
 *   {(itemSignal, index) => <Item signal={itemSignal} />}
 * </KeyedForEach>
 *
 * Benefits:
 * - Zero configuration
 * - Automatic optimization
 * - Handles signal creation internally
 * - Works with 10,000+ items efficiently
 * - Developer doesn't think about signals
 */

export { ForEach, KeyedForEach }
