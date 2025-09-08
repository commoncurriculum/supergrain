# @storable/app-store

Document-oriented app store for Storable with TypeScript support and promise-like reactive API.

Built on top of the proven [@storable/core](../core) reactivity system to provide a simple API for finding and inserting documents by type and ID, with automatic caching and optimistic updates.

## Features

- 🗂️ **Document-oriented** - Store and retrieve documents by type and ID
- 🔄 **Promise-like API** - Familiar async patterns with `content`, `isPending`, `isSettled`, etc.
- 📝 **Full TypeScript support** - Type-safe document retrieval with model registry
- ⚡ **Reactive** - Built on @storable/core for fine-grained reactivity
- 🚀 **Automatic fetching** - Configurable fetch handlers for external data sources
- 💾 **Caching** - Documents cached automatically, no duplicate requests
- 🔄 **Optimistic updates** - Immediate UI updates for insertions

## Installation

```bash
npm install @storable/app-store @storable/core
# or
pnpm add @storable/app-store @storable/core
```

## Quick Start

### Define Your Document Types

```typescript
interface User {
  id: number
  firstName: string
  lastName: string
  email: string
}

interface Post {
  id: number
  title: string
  content: string
  userId: number
  likes: number
}

// Global type registry for your app
interface DocumentTypes {
  users: User
  posts: Post
}
```

### Create App Store

```typescript
import { AppStore } from '@storable/app-store'

// With fetch handler for automatic data loading
const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
  const response = await fetch(`/api/${modelType}/${id}`)
  if (!response.ok) throw new Error('Failed to fetch')
  return response.json()
})

// Or without fetch handler (manual data management)
const appStore = new AppStore<DocumentTypes>()
```

### Use in Components

```typescript
function BlogPost({ postId }: { postId: number }) {
  // Automatically fetches post if not in cache
  const post = appStore.findDoc("posts", postId)

  // Chain reactive dependencies
  const author = appStore.findDoc("users", post.content?.userId)

  if (post.isPending) return <div>Loading post...</div>
  if (post.isRejected) return <div>Error: Failed to load post</div>
  if (!post.content) return <div>Post not found</div>

  return (
    <article>
      <h1>{post.content.title}</h1>
      <p>By: {author.content?.firstName} {author.content?.lastName}</p>
      <div>{post.content.content}</div>
      <div>❤️ {post.content.likes} likes</div>
    </article>
  )
}
```

### Insert New Documents

```typescript
// Create new user (optimistic update)
const newUser = await appStore.insertDocument('users', {
  id: 123,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com'
})

// Document immediately available in UI
const user = appStore.findDoc('users', 123)
console.log(user.content) // { id: 123, firstName: 'John', ... }
```

### Manual Document Management

```typescript
// Set document content directly
appStore.setDocument('users', 1, {
  id: 1,
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com'
})

// Handle errors
appStore.setDocumentError('users', 999, 'User not found')

const user = appStore.findDoc('users', 999)
console.log(user.isRejected) // true
```

## API Reference

### AppStore Class

#### `new AppStore<T>(fetchHandler?)`

Creates a new app store instance.

- `fetchHandler` *(optional)*: `(modelType: string, id: string | number) => Promise<any>`
  - Called automatically when documents are not in cache
  - Should return the document data or throw an error

#### `findDoc<K>(modelType: K, id: string | number): DocumentPromise<T[K]>`

Retrieves a document by type and ID. Returns immediately with cached data or triggers fetch if needed.

- `modelType`: Document type key from your `DocumentTypes` interface
- `id`: Document ID (string or number)
- Returns: `DocumentPromise` with reactive content

#### `setDocument<K>(modelType: K, id: string | number, data: T[K]): void`

Manually sets document content and marks as fulfilled.

#### `setDocumentError<K>(modelType: K, id: string | number, error: string): void`

Manually sets document as rejected with error message.

#### `insertDocument<K>(modelType: K, data: Partial<T[K]> & { id: string | number }): Promise<T[K]>`

Inserts a new document with optimistic updates.

- Shows as pending immediately
- Resolves when insertion completes
- Document becomes available to `findDoc` calls immediately

### DocumentPromise Interface

The promise-like object returned by `findDoc`:

```typescript
interface DocumentPromise<T> {
  content: T | undefined        // Document data (undefined if not loaded)
  isPending: boolean           // Request in progress
  isSettled: boolean          // Request completed (success or failure)
  isRejected: boolean         // Request failed
  isFulfilled: boolean        // Request succeeded
}
```

### Document States

Documents progress through these states:

1. **Not fetched** - Document doesn't exist in store
2. **Pending** - Fetch in progress or insertion in progress
3. **Fulfilled** - Successfully loaded/inserted with content
4. **Rejected** - Failed with error message

## Advanced Usage

### Reactive Computations

```typescript
import { computed } from '@storable/core'

function UserProfile({ userId }: { userId: number }) {
  const user = appStore.findDoc('users', userId)

  // Reactive derived value
  const displayName = computed(() =>
    user.content ? `${user.content.firstName} ${user.content.lastName}` : 'Unknown'
  )

  return <div>Welcome, {displayName()}!</div>
}
```

### Error Handling Patterns

```typescript
function PostWithErrorHandling({ postId }: { postId: number }) {
  const post = appStore.findDoc('posts', postId)

  // Loading state
  if (post.isPending) {
    return <div className="spinner">Loading...</div>
  }

  // Error state
  if (post.isRejected) {
    return (
      <div className="error">
        <p>Failed to load post</p>
        <button onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    )
  }

  // Success state
  return <BlogPost post={post.content!} />
}
```

### Custom Fetch Handlers

```typescript
// With authentication
const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
  const token = getAuthToken()
  const response = await fetch(`/api/${modelType}/${id}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })

  if (response.status === 401) {
    redirectToLogin()
    throw new Error('Authentication required')
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json()
})

// With caching headers
const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
  const response = await fetch(`/api/${modelType}/${id}`, {
    headers: { 'Cache-Control': 'max-age=300' } // 5 minutes
  })
  return response.json()
})
```

### Multiple Document Types

```typescript
interface DocumentTypes {
  users: User
  posts: Post
  comments: Comment
  tags: Tag
  categories: Category
}

function BlogPostFull({ postId }: { postId: number }) {
  const post = appStore.findDoc('posts', postId)
  const author = appStore.findDoc('users', post.content?.userId)
  const category = appStore.findDoc('categories', post.content?.categoryId)

  // All documents fetched reactively as needed
  return (
    <article>
      <header>
        <h1>{post.content?.title}</h1>
        <p>By {author.content?.firstName} in {category.content?.name}</p>
      </header>
      <div>{post.content?.content}</div>
    </article>
  )
}
```

## TypeScript Integration

### Extending DocumentTypes

```typescript
// In your app's types file
declare global {
  interface DocumentTypes {
    users: User
    posts: Post
    // Add more document types as needed
  }
}

// Now AppStore automatically knows about these types
const appStore = new AppStore() // No generic needed!
```

### Type-Safe Document Access

```typescript
// TypeScript knows post.content is Post | undefined
const post = appStore.findDoc('posts', 1)

// TypeScript knows user.content is User | undefined
const user = appStore.findDoc('users', post.content?.userId)

// Type error: 'invalid' is not a key of DocumentTypes
const invalid = appStore.findDoc('invalid', 1) // ❌ TypeScript error
```

## React Integration

While the app store works standalone, it pairs perfectly with React:

```typescript
import { useEffect, useState } from 'react'

function useDocument<K extends keyof DocumentTypes>(
  modelType: K,
  id: string | number
) {
  const doc = appStore.findDoc(modelType, id)
  const [, forceUpdate] = useState({})

  useEffect(() => {
    // Subscribe to document changes
    const unsubscribe = effect(() => {
      doc.content // Access to trigger reactivity
      doc.isPending
      doc.isRejected
      forceUpdate({}) // Force React re-render
    })

    return unsubscribe
  }, [doc])

  return doc
}

// Usage
function MyComponent({ postId }: { postId: number }) {
  const post = useDocument('posts', postId)

  if (post.isPending) return <div>Loading...</div>
  return <div>{post.content?.title}</div>
}
```

## Performance Notes

- **Caching**: Documents are cached by type and ID, preventing duplicate fetches
- **Fine-grained reactivity**: Only components using changed documents re-render
- **Batched updates**: Multiple document updates are automatically batched
- **Memory efficient**: Built on proven alien-signals reactivity system

## Migration Guide

### From Redux/RTK Query

```typescript
// Before: RTK Query
const { data: post, isLoading, error } = useGetPostQuery(postId)

// After: App Store
const post = appStore.findDoc('posts', postId)
if (post.isPending) // isLoading equivalent
if (post.isRejected) // error equivalent
const data = post.content // data equivalent
```

### From React Query

```typescript
// Before: React Query
const { data: post, isLoading, isError } = useQuery(['posts', postId],
  () => fetchPost(postId)
)

// After: App Store
const post = appStore.findDoc('posts', postId)
// Same reactive API, but with better TypeScript integration
```

## License

MIT
