import { signal, computed, Signal } from 'alien-signals'
import { createStore, unwrap } from '../packages/core/src'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import { useRef, useMemo } from 'react'

// ============================================
// CORE IMPLEMENTATION
// ============================================

interface StoreWithSignalAccess<T> {
  state: T
  update: (operations: any) => void
  getSignal: (path: string | string[]) => Signal<any>
  // Alternative: access via property
  $: {
    [K in keyof T]: Signal<T[K]>
  }
}

/**
 * Enhanced createStore that provides signal access for specific paths
 * while maintaining the simple proxy-based API
 */
export function createStoreWithSignalAccess<T extends object>(
  initialState: T
): StoreWithSignalAccess<T> {
  // Create the base store
  const [state, update] = createStore(initialState)

  // Cache for path-based signals
  const signalCache = new Map<string, Signal<any>>()

  /**
   * Get or create a signal for a specific path in the store
   */
  function getSignal(path: string | string[]): Signal<any> {
    const pathStr = Array.isArray(path) ? path.join('.') : path

    if (!signalCache.has(pathStr)) {
      // Create a computed signal that tracks only this specific path
      const pathSignal = computed(() => {
        const pathParts = pathStr.split('.')
        let value: any = state

        for (const part of pathParts) {
          if (value == null) return undefined
          value = value[part]
        }

        return value
      })

      signalCache.set(pathStr, pathSignal)
    }

    return signalCache.get(pathStr)!
  }

  /**
   * Create a proxy that returns signals when accessed via $
   */
  const signalProxy = new Proxy({} as any, {
    get(target, prop) {
      return getSignal(String(prop))
    },
  })

  return {
    state,
    update,
    getSignal,
    $: signalProxy,
  }
}

// ============================================
// REACT HOOKS
// ============================================

/**
 * Hook to subscribe to a specific signal
 */
export function useSignalValue<T>(signal: Signal<T>): T {
  const store = useMemo(() => {
    let version = 0
    let notify: (() => void) | null = null

    const unsubscribe = signal.subscribe(() => {
      version = (version + 1) | 0
      notify?.()
    })

    return {
      subscribe(onStoreChange: () => void) {
        notify = onStoreChange
        return () => {
          notify = null
          unsubscribe()
        }
      },
      getSnapshot() {
        return version
      },
    }
  }, [signal])

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  return signal()
}

/**
 * Hook for the entire store with signal access
 */
export function useStore<T extends object>(
  store: StoreWithSignalAccess<T>
): [T, typeof store.update, typeof store.getSignal] {
  const state = useStoreValue(store.getSignal(''))
  return [state || store.state, store.update, store.getSignal]
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
  id: string
  title: string
  views: number
  comments: Comment[]
}

// Create a store with signal access
const postStore = createStoreWithSignalAccess<Post>({
  id: 'post-1',
  title: 'My Post',
  views: 100,
  comments: [
    { id: 'c1', text: 'Great!', author: 'Alice', likes: 5 },
    { id: 'c2', text: 'Thanks!', author: 'Bob', likes: 3 },
  ],
})

// ============================================
// REACT COMPONENTS
// ============================================

/**
 * Parent component - uses proxy for convenience
 */
function BlogPost() {
  // Simple access to state
  const state = postStore.state

  return (
    <article>
      <h1>{state.title}</h1>
      <p>Views: {state.views}</p>

      {/* Pass signals to children for optimization */}
      {state.comments.map((comment, index) => (
        <Comment
          key={comment.id}
          commentSignal={postStore.getSignal(`comments.${index}`)}
          onLike={() => {
            postStore.update({
              $inc: { [`comments.${index}.likes`]: 1 },
            })
          }}
        />
      ))}

      <button onClick={() => postStore.update({ $inc: { views: 1 } })}>
        View Post
      </button>
    </article>
  )
}

/**
 * Child component - subscribes to specific signal
 */
function Comment({
  commentSignal,
  onLike,
}: {
  commentSignal: Signal<Comment>
  onLike: () => void
}) {
  // Only re-renders when THIS comment changes
  const comment = useSignalValue(commentSignal)

  console.log(`Rendering comment ${comment.id}`)

  return (
    <div className="comment">
      <p>{comment.text}</p>
      <small>by {comment.author}</small>
      <button onClick={onLike}>👍 {comment.likes}</button>
    </div>
  )
}

// ============================================
// ADVANCED PATTERNS
// ============================================

/**
 * Pattern 1: Selective signal optimization
 */
function SelectiveOptimization() {
  const state = postStore.state

  return (
    <div>
      {/* Static content - use proxy */}
      <header>{state.title}</header>

      {/* Dynamic list - use signals */}
      <CommentList />
    </div>
  )
}

function CommentList() {
  // Subscribe only to comments array
  const comments = useSignalValue(postStore.getSignal('comments'))

  return (
    <div>
      {comments.map((_, index) => (
        <Comment
          key={comments[index].id}
          commentSignal={postStore.getSignal(['comments', index])}
          onLike={() => {
            /* ... */
          }}
        />
      ))}
    </div>
  )
}

/**
 * Pattern 2: Deeply nested optimization
 */
interface NestedData {
  users: {
    [id: string]: {
      profile: {
        name: string
        settings: {
          theme: string
          notifications: boolean
        }
      }
      posts: Post[]
    }
  }
}

const nestedStore = createStoreWithSignalAccess<NestedData>({
  users: {
    user1: {
      profile: {
        name: 'Alice',
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
      posts: [],
    },
  },
})

function UserSettings({ userId }: { userId: string }) {
  // Subscribe only to this user's settings
  const settingsSignal = nestedStore.getSignal(
    `users.${userId}.profile.settings`
  )
  const settings = useSignalValue(settingsSignal)

  // This component ONLY re-renders when settings change
  // Not when user name changes, not when posts change
  return (
    <div>
      <label>
        Theme: {settings.theme}
        <button
          onClick={() => {
            nestedStore.update({
              $set: {
                [`users.${userId}.profile.settings.theme`]:
                  settings.theme === 'dark' ? 'light' : 'dark',
              },
            })
          }}
        >
          Toggle
        </button>
      </label>
    </div>
  )
}

/**
 * Pattern 3: Mixed granularity
 */
function MixedGranularity() {
  const state = postStore.state

  // Use computed for derived values
  const stats = useMemo(
    () => ({
      totalComments: state.comments.length,
      totalLikes: state.comments.reduce((sum, c) => sum + c.likes, 0),
    }),
    [state.comments]
  )

  return (
    <div>
      <Stats {...stats} />
      {/* Each comment still has its own signal */}
      {state.comments.map((_, i) => (
        <OptimizedComment key={state.comments[i].id} index={i} />
      ))}
    </div>
  )
}

function OptimizedComment({ index }: { index: number }) {
  const commentSignal = postStore.getSignal(`comments.${index}`)
  const comment = useSignalValue(commentSignal)

  return (
    <div>
      {comment.text} ({comment.likes} likes)
    </div>
  )
}

// ============================================
// PERFORMANCE BENEFITS
// ============================================

/**
 * With this hybrid approach:
 *
 * 1. Post title changes -> Only BlogPost header re-renders
 * 2. Comment likes change -> Only that specific Comment re-renders
 * 3. New comment added -> BlogPost re-renders, existing Comments don't
 * 4. Views increment -> Only the views counter re-renders
 *
 * All while maintaining:
 * - Simple proxy-based reads
 * - MongoDB-style updates
 * - No manual signal management
 * - Progressive enhancement
 */

export { createStoreWithSignalAccess, useSignalValue, useStore }
