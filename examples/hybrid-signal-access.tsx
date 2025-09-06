import React from 'react'
import { createStore, Signal } from '../packages/core/src'
import { useStoreValue } from '../packages/react-adapter'

// ============================================
// HYBRID API DESIGN: BEST OF BOTH WORLDS
// ============================================

/**
 * The key insight: We can provide a special property accessor
 * that returns the signal for a specific path, while keeping
 * the default proxy behavior for normal access.
 */

interface StoreWithSignals<T> {
  // The proxied state for easy access
  state: T
  // Function to get signal for a specific path
  signal: (path: string) => Signal<any>
  // The update function
  update: (operations: any) => void
}

// ============================================
// PROPOSED API
// ============================================

// Instead of just [state, update], we could return an object with utilities
const postStore = createStoreWithSignals<Post>({
  id: 'post-1',
  title: 'Understanding Signals vs Proxies',
  content: 'This post explores the performance trade-offs...',
  views: 1520,
  comments: [
    {
      id: 'comment-1',
      text: 'Great article!',
      author: 'Alice',
      likes: 5,
      tags: [
        { id: 'tag-1', title: 'helpful' },
        { id: 'tag-2', title: 'insightful' },
      ],
    },
    {
      id: 'comment-2',
      text: 'I have questions...',
      author: 'Bob',
      likes: 3,
      tags: [
        { id: 'tag-3', title: 'question' },
      ],
    },
  ],
})

// ============================================
// USAGE EXAMPLE 1: ACCESS SPECIFIC SIGNALS
// ============================================

function OptimizedPost() {
  // Access the proxy for convenient reads
  const post = useStoreValue(postStore.state)

  return (
    <article>
      <h1>{post.title}</h1>
      <p>Views: {post.views}</p>

      {post.comments.map((comment, index) => (
        // Pass the signal for this specific comment!
        // This component won't re-render when other parts change
        <OptimizedComment
          key={comment.id}
          commentSignal={postStore.signal(`comments.${index}`)}
          path={`comments.${index}`}
        />
      ))}
    </article>
  )
}

function OptimizedComment({
  commentSignal,
  path
}: {
  commentSignal: Signal<Comment>
  path: string
}) {
  // This component ONLY subscribes to this specific comment signal
  const comment = useSignalValue(commentSignal)

  return (
    <div className="comment">
      <p>{comment.text} by {comment.author}</p>
      <div>👍 {comment.likes}</div>

      {comment.tags.map((tag, index) => (
        // We can go deeper! Get signals for individual tags
        <OptimizedTag
          key={tag.id}
          tagSignal={postStore.signal(`${path}.tags.${index}`)}
        />
      ))}

      <button onClick={() => {
        // Still use the nice update API
        postStore.update({
          $inc: { [`${path}.likes`]: 1 }
        })
      }}>
        Like
      </button>
    </div>
  )
}

function OptimizedTag({ tagSignal }: { tagSignal: Signal<Tag> }) {
  const tag = useSignalValue(tagSignal)
  return <span className="tag">#{tag.title}</span>
}

// ============================================
// USAGE EXAMPLE 2: MIXED APPROACH
// ============================================

function MixedApproach() {
  const post = useStoreValue(postStore.state)

  // For parts that rarely change, just use proxy
  const metadata = (
    <div>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </div>
  )

  // For dynamic lists, use signals
  const comments = (
    <div>
      {post.comments.map((_, index) => (
        <CommentWithSignal
          key={post.comments[index].id}
          commentSignal={postStore.signal(`comments.${index}`)}
        />
      ))}
    </div>
  )

  return <article>{metadata}{comments}</article>
}

// ============================================
// ALTERNATIVE API: SIGNAL GETTER ON PROXY
// ============================================

/**
 * Another approach: Add a special property to the proxy
 * that returns signals instead of values
 */

// Imagine this API:
function AlternativeAPI() {
  const [state, update] = createStore(initialPost)

  return (
    <div>
      {state.comments.map((comment, index) => (
        <OptimizedComment
          key={comment.id}
          // Access signal via special $ property
          commentSignal={state.$signals.comments[index]}
          comment={comment}
        />
      ))}
    </div>
  )
}

// Or even simpler with a helper function:
function SimplerAPI() {
  const [state, update, getSignal] = createStore(initialPost)

  return (
    <div>
      {state.comments.map((comment, index) => (
        <OptimizedComment
          key={comment.id}
          // Get signal for any path
          commentSignal={getSignal(['comments', index])}
          comment={comment}
        />
      ))}
    </div>
  )
}

// ============================================
// IMPLEMENTATION SKETCH
// ============================================

/**
 * How this would work internally:
 *
 * 1. The store maintains a map of paths to signals
 * 2. When you call getSignal('comments.0'), it:
 *    - Checks if a signal exists for that path
 *    - If not, creates one lazily
 *    - Returns the signal
 * 3. The signal is automatically updated when that path changes
 * 4. Components can subscribe to specific signals
 */

function createStoreWithSignals<T>(initial: T) {
  const [state, update] = createStore(initial)

  // Map to store signals for paths
  const signalCache = new Map<string, Signal<any>>()

  function getSignal(path: string): Signal<any> {
    if (!signalCache.has(path)) {
      // Create a computed signal for this path
      const pathSignal = computed(() => {
        // Get value at path from state
        return getValueAtPath(state, path)
      })
      signalCache.set(path, pathSignal)
    }
    return signalCache.get(path)!
  }

  return {
    state,
    update,
    signal: getSignal,
  }
}

// ============================================
// BENEFITS OF THIS APPROACH
// ============================================

/**
 * ✅ Default to simple proxy access
 * ✅ Opt-in to signal access for optimization
 * ✅ No re-renders when parent data changes
 * ✅ Still use MongoDB-style updates
 * ✅ Progressive enhancement - optimize only what needs it
 * ✅ Signals are created lazily on demand
 * ✅ Clean component boundaries
 *
 * Example scenario:
 * - Post title changes -> only Post re-renders
 * - Comment likes change -> only that Comment re-renders
 * - New comment added -> Post re-renders, existing Comments don't
 * - Tag updated -> only that Tag re-renders
 */

// ============================================
// PERFORMANCE COMPARISON
// ============================================

/**
 * PURE PROXY:
 * - Post changes -> Post re-renders -> all children re-render
 * - Need React.memo everywhere to prevent this
 *
 * PURE SIGNALS:
 * - Complex to set up and maintain
 * - Need signals for everything
 *
 * HYBRID (THIS APPROACH):
 * - Post changes -> only Post re-renders
 * - Comments have their own signals, don't re-render
 * - Best of both worlds!
 */

// ============================================
// REAL WORLD EXAMPLE
// ============================================

function TodoList() {
  const [todos, updateTodos, getSignal] = createStore({
    items: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      text: `Todo ${i}`,
      done: false,
    })),
    filter: 'all',
  })

  const visibleTodos = useComputed(() => {
    switch (todos.filter) {
      case 'active': return todos.items.filter(t => !t.done)
      case 'done': return todos.items.filter(t => t.done)
      default: return todos.items
    }
  })

  return (
    <div>
      {/* Filter buttons use proxy - simple */}
      <FilterButtons filter={todos.filter} onFilterChange={...} />

      {/* Each todo gets its own signal - no re-renders! */}
      {visibleTodos.map((todo, index) => (
        <TodoItem
          key={todo.id}
          todoSignal={getSignal(['items', todos.items.indexOf(todo)])}
        />
      ))}
    </div>
  )
}

function TodoItem({ todoSignal }: { todoSignal: Signal<Todo> }) {
  const todo = useSignalValue(todoSignal)

  // This component ONLY re-renders when its specific todo changes
  // Not when other todos change, not when filter changes, etc.
  return (
    <div>
      <input type="checkbox" checked={todo.done} />
      <span>{todo.text}</span>
    </div>
  )
}
