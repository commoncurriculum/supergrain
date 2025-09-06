import React from 'react'
import { createStore } from '../packages/core/src'
import { useStoreValue } from '../packages/react-adapter'

// ============================================
// SHARED DATA STRUCTURE
// ============================================
interface Tag {
  id: string
  title: string
}

interface Comment {
  id: string
  text: string
  author: string
  tags: Tag[]
  likes: number
}

interface Post {
  id: string
  title: string
  content: string
  comments: Comment[]
  views: number
}

// ============================================
// APPROACH 1: PROXY-BASED (WHAT WE RECOMMEND)
// ============================================

const [proxyPost, updateProxyPost] = createStore<Post>({
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
  ],
})

// Components just receive normal objects - no complexity!
function ProxyTag({ tag }: { tag: Tag }) {
  // Just use the data normally
  return <span className="tag">#{tag.title}</span>
}

function ProxyComment({ comment, path }: { comment: Comment; path: string }) {
  return (
    <div className="comment">
      <p>
        {comment.text} by {comment.author}
      </p>
      <div>👍 {comment.likes}</div>

      {/* Pass nested objects naturally */}
      {comment.tags.map(tag => (
        <ProxyTag key={tag.id} tag={tag} />
      ))}

      {/* Simple updates with path */}
      <button
        onClick={() => {
          updateProxyPost({
            $inc: { [`${path}.likes`]: 1 },
          })
        }}
      >
        Like
      </button>
    </div>
  )
}

function ProxyPost() {
  // Hook makes component reactive
  const post = useStoreValue(proxyPost)

  return (
    <article>
      <h1>{post.title}</h1>
      <p>Views: {post.views}</p>

      {/* Natural prop passing */}
      {post.comments.map((comment, i) => (
        <ProxyComment
          key={comment.id}
          comment={comment}
          path={`comments.${i}`}
        />
      ))}

      {/* Easy updates */}
      <button
        onClick={() => {
          updateProxyPost({
            $push: {
              comments: {
                id: 'new-comment',
                text: 'New comment!',
                author: 'Charlie',
                likes: 0,
                tags: [],
              },
            },
          })
        }}
      >
        Add Comment
      </button>
    </article>
  )
}

// ============================================
// APPROACH 2: DIRECT SIGNALS (MORE COMPLEX)
// ============================================

import { signal, computed } from '../packages/core/src'

// Need to manually create and manage signals
const postSignal = signal<Post>({
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
  ],
})

// Need computed signals for performance
const postCommentsSignal = computed(() => postSignal().comments)

// Components receive signals, not objects
function SignalTag({ tag }: { tag: Tag }) {
  // Still simple at leaf level
  return <span className="tag">#{tag.title}</span>
}

function SignalComment({ comment }: { comment: Comment }) {
  return (
    <div className="comment">
      <p>
        {comment.text} by {comment.author}
      </p>
      <div>👍 {comment.likes}</div>

      {/* Still passing objects here, losing some benefits */}
      {comment.tags.map(tag => (
        <SignalTag key={tag.id} tag={tag} />
      ))}

      {/* Complex immutable updates */}
      <button
        onClick={() => {
          const current = postSignal()
          postSignal({
            ...current,
            comments: current.comments.map(c =>
              c.id === comment.id ? { ...c, likes: c.likes + 1 } : c
            ),
          })
        }}
      >
        Like
      </button>
    </div>
  )
}

function SignalPost() {
  // Need to subscribe to computed signal
  const comments = useSignalValue(postCommentsSignal)
  const post = useSignalValue(postSignal)

  return (
    <article>
      <h1>{post.title}</h1>
      <p>Views: {post.views}</p>

      {/* Props are still objects unless we create more signals */}
      {comments.map(comment => (
        <SignalComment key={comment.id} comment={comment} />
      ))}

      {/* Manual immutable updates */}
      <button
        onClick={() => {
          const current = postSignal()
          postSignal({
            ...current,
            comments: [
              ...current.comments,
              {
                id: 'new-comment',
                text: 'New comment!',
                author: 'Charlie',
                likes: 0,
                tags: [],
              },
            ],
          })
        }}
      >
        Add Comment
      </button>
    </article>
  )
}

// ============================================
// KEY OBSERVATIONS
// ============================================

/*
PROXY APPROACH (Hidden Signals):
✅ Components receive normal objects
✅ Natural prop passing
✅ MongoDB-style updates with paths
✅ Automatic fine-grained tracking
✅ No signal management needed

❌ Proxy overhead on each property access
❌ ~2-15x slower for property access
❌ Still fast enough for most apps (millions ops/sec)

SIGNAL APPROACH (Exposed):
✅ Direct signal access is faster
✅ More control over reactivity
✅ Can optimize hot paths

❌ Need to create/manage signals manually
❌ Complex immutable updates
❌ Lose benefits if passing objects anyway
❌ Much more boilerplate code

THE REALITY:
In the signal approach, you often end up passing objects to child
components anyway (like comment to SignalComment), which means you
lose the performance benefits unless you create signals all the way down.

This would require:
- A signal for each comment
- A signal for each tag
- Computed signals for derived data
- Managing signal lifecycle/cleanup

The complexity grows exponentially with nesting depth!

RECOMMENDATION:
Use proxy approach by default. The performance difference only matters
for truly performance-critical paths (large lists, animations, etc.)
and the DX improvement is massive.
*/
