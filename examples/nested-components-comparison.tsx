import React from 'react'
import { createStore, signal, computed, effect } from '../packages/core/src'
import { useStore, useStoreValue } from '../packages/react-adapter' // hypothetical

// ============================================
// DATA STRUCTURE
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

const initialPost: Post = {
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
      text: 'I have some questions about performance...',
      author: 'Bob',
      likes: 3,
      tags: [
        { id: 'tag-3', title: 'question' },
        { id: 'tag-4', title: 'performance' },
      ],
    },
  ],
}

// ============================================
// APPROACH 1: PROXY-BASED (HIDDEN SIGNALS)
// ============================================

// Global store with proxy-based state
const [proxyPost, updateProxyPost] = createStore(initialPost)

// --- Proxy Components ---

function ProxyTag({ tag }: { tag: Tag }) {
  console.log(`ProxyTag render: ${tag.id}`)

  // Each component that receives proxy state automatically tracks
  // what it accesses. This component only re-renders if THIS
  // specific tag's id or title changes.
  return <span className="tag">#{tag.title}</span>
}

function ProxyComment({ comment }: { comment: Comment }) {
  console.log(`ProxyComment render: ${comment.id}`)

  // This component tracks: comment.text, comment.author, comment.likes
  // and the comment.tags array. It re-renders if any of these change.
  // However, changes INSIDE individual tags don't trigger re-renders here.
  return (
    <div className="comment">
      <div className="comment-header">
        <strong>{comment.author}</strong>
        <span className="likes">👍 {comment.likes}</span>
      </div>
      <p>{comment.text}</p>
      <div className="tags">
        {comment.tags.map(tag => (
          // Passing proxy objects down - each child tracks its own deps
          <ProxyTag key={tag.id} tag={tag} />
        ))}
      </div>
      <button
        onClick={() => {
          // Update using MongoDB-style operators
          const postIndex = proxyPost.comments.findIndex(
            c => c.id === comment.id
          )
          updateProxyPost({
            $inc: { [`comments.${postIndex}.likes`]: 1 },
          })
        }}
      >
        Like
      </button>
    </div>
  )
}

function ProxyPost() {
  // Make component reactive to proxy state
  const post = useStoreValue(proxyPost)

  console.log('ProxyPost render')

  // This component tracks: post.title, post.content, post.views,
  // and the post.comments array reference
  return (
    <article className="post">
      <h1>{post.title}</h1>
      <p className="views">Views: {post.views}</p>
      <div className="content">{post.content}</div>

      <section className="comments">
        <h2>Comments ({post.comments.length})</h2>
        {post.comments.map(comment => (
          // Passing proxy objects down the tree
          <ProxyComment key={comment.id} comment={comment} />
        ))}
      </section>

      <button
        onClick={() => {
          updateProxyPost({ $inc: { views: 1 } })
        }}
      >
        View Post
      </button>
    </article>
  )
}

// ============================================
// APPROACH 2: DIRECT SIGNALS (EXPOSED)
// ============================================

// With exposed signals, we create signals for each level
const postSignal = signal(initialPost)

// For optimal performance, we'd create computed signals for each part
// This prevents unnecessary re-computation when unrelated parts change
const postTitleSignal = computed(() => postSignal().title)
const postContentSignal = computed(() => postSignal().content)
const postViewsSignal = computed(() => postSignal().views)
const postCommentsSignal = computed(() => postSignal().comments)

// We could even create signals for individual comments if needed
const commentSignals = new Map<string, ReturnType<typeof computed>>()

function getCommentSignal(commentId: string) {
  if (!commentSignals.has(commentId)) {
    commentSignals.set(
      commentId,
      computed(() => postSignal().comments.find(c => c.id === commentId))
    )
  }
  return commentSignals.get(commentId)!
}

// --- Signal Components ---

function SignalTag({ tagSignal }: { tagSignal: () => Tag }) {
  // Component subscribes to this specific signal
  const tag = useSignalValue(tagSignal)

  console.log(`SignalTag render: ${tag.id}`)

  return <span className="tag">#{tag.title}</span>
}

function SignalComment({
  commentSignal,
}: {
  commentSignal: () => Comment | undefined
}) {
  const comment = useSignalValue(commentSignal)

  if (!comment) return null

  console.log(`SignalComment render: ${comment.id}`)

  // Create computed signals for tags to prevent re-renders
  // when other parts of the comment change
  const tagsSignal = computed(() => comment.tags)

  return (
    <div className="comment">
      <div className="comment-header">
        <strong>{comment.author}</strong>
        <span className="likes">👍 {comment.likes}</span>
      </div>
      <p>{comment.text}</p>
      <div className="tags">
        {comment.tags.map((tag, index) => (
          // We need to create a signal for each tag for optimal performance
          // This is where it gets complex!
          <SignalTag key={tag.id} tagSignal={() => tagsSignal()[index]} />
        ))}
      </div>
      <button
        onClick={() => {
          // Direct signal update - need to manage immutability manually
          const currentPost = postSignal()
          const updatedComments = currentPost.comments.map(c =>
            c.id === comment.id ? { ...c, likes: c.likes + 1 } : c
          )
          postSignal({ ...currentPost, comments: updatedComments })
        }}
      >
        Like
      </button>
    </div>
  )
}

function SignalPost() {
  // Subscribe to individual signals for fine-grained updates
  const title = useSignalValue(postTitleSignal)
  const content = useSignalValue(postContentSignal)
  const views = useSignalValue(postViewsSignal)
  const comments = useSignalValue(postCommentsSignal)

  console.log('SignalPost render')

  return (
    <article className="post">
      <h1>{title}</h1>
      <p className="views">Views: {views}</p>
      <div className="content">{content}</div>

      <section className="comments">
        <h2>Comments ({comments.length})</h2>
        {comments.map(comment => (
          // Pass computed signal for each comment
          <SignalComment
            key={comment.id}
            commentSignal={() => getCommentSignal(comment.id)()}
          />
        ))}
      </section>

      <button
        onClick={() => {
          const current = postSignal()
          postSignal({ ...current, views: current.views + 1 })
        }}
      >
        View Post
      </button>
    </article>
  )
}

// ============================================
// PERFORMANCE COMPARISON
// ============================================

function PerformanceComparison() {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}
    >
      <div>
        <h2>Proxy-Based Approach</h2>
        <ProxyPost />
        <div className="pros-cons">
          <h3>Pros:</h3>
          <ul>
            <li>✅ Simple prop passing - just pass objects</li>
            <li>✅ Automatic dependency tracking</li>
            <li>✅ MongoDB-style updates</li>
            <li>✅ No signal management</li>
            <li>✅ Feels like normal React</li>
          </ul>
          <h3>Cons:</h3>
          <ul>
            <li>❌ Proxy overhead on every property access</li>
            <li>❌ Harder to optimize specific paths</li>
            <li>❌ More re-renders if not using React.memo</li>
          </ul>
        </div>
      </div>

      <div>
        <h2>Direct Signals Approach</h2>
        <SignalPost />
        <div className="pros-cons">
          <h3>Pros:</h3>
          <ul>
            <li>✅ Maximum performance</li>
            <li>✅ Fine-grained control</li>
            <li>✅ Can create computed signals for expensive operations</li>
            <li>✅ Minimal re-renders</li>
          </ul>
          <h3>Cons:</h3>
          <ul>
            <li>❌ Complex signal management</li>
            <li>❌ Need to create signals for each level</li>
            <li>❌ Manual immutable updates</li>
            <li>❌ Harder to understand and maintain</li>
            <li>❌ Props are functions, not objects</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ============================================
// WHAT HAPPENS WHEN WE UPDATE?
// ============================================

/*
SCENARIO: Update tag title for tag-1

PROXY APPROACH:
1. updateProxyPost({ $set: { 'comments.0.tags.0.title': 'amazing' } })
2. Only ProxyTag for tag-1 re-renders
3. Parent components don't re-render (assuming React.memo or proper tracking)

SIGNAL APPROACH:
1. Need to update the entire post signal with immutable update
2. All computed signals re-evaluate
3. Only components subscribed to changed signals re-render
4. More efficient but requires more setup

SCENARIO: Add a new comment

PROXY APPROACH:
1. updateProxyPost({ $push: { comments: newComment } })
2. ProxyPost re-renders (comments.length changed)
3. New ProxyComment renders
4. Existing comments don't re-render

SIGNAL APPROACH:
1. Update entire post signal
2. postCommentsSignal re-evaluates
3. SignalPost re-renders
4. Need to ensure existing comment signals are stable
*/

export default PerformanceComparison
