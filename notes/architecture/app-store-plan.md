# App-Level Store Design

> **Status:** Implemented as `@supergrain/store`.
>
> **TL;DR:** A document-oriented store built on `@supergrain/core` that provides `findDoc`/`insertDocument` by type and ID, with full TypeScript safety via a global type registry. Uses a single unified store (not Map<string, Store>) for cross-document reactivity, atomic batched updates, and simpler state management.

## Goal

Create a simple, type-safe, reactive document store for local-first apps. The API should feel like a promise-based document lookup:

```typescript
function MyComponent() {
  let post1 = findDoc("posts", 1)
  let user = findDoc("users", post1.content?.userId)
  let text = computed(() => `${user.content?.firstName} has ${post1.content?.likes} likes on this`)

  return (
    <>{post1.content?.title} by {user.content?.firstName} ({text()})</>
  )
}
```

## Key Design Decisions

### Single Store (not Map<string, Store>)

All documents live in one Supergrain store. Rationale:

1. **Unified reactivity** -- cross-document dependencies work naturally
2. **Better performance** -- single subscription system
3. **Atomic operations** -- update multiple document types in one batch
4. **Simpler testing** -- one store to mock

### Store Shape

```typescript
interface AppStoreState {
  documents: {
    [modelType: string]: {
      [id: string]: {
        content: any
        status: 'pending' | 'fulfilled' | 'rejected'
        error?: string
        lastFetched?: number
      }
    }
  }
  // Extensible: ui, settings, etc.
}
```

Example state:

```typescript
{
  documents: {
    users: {
      "1": { content: { id: 1, name: "John" }, status: "fulfilled" },
      "2": { content: { id: 2, name: "Jane" }, status: "pending" }
    },
    posts: {
      "1": { content: { id: 1, title: "Hello", userId: 1 }, status: "fulfilled" }
    }
  }
}
```

## TypeScript Integration

### Global Type Registry

Users declare their document types once:

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

interface DocumentTypes {
  users: User
  posts: Post
}
```

### DocumentPromise Return Type

`findDoc` returns a reactive promise-like wrapper:

```typescript
interface DocumentPromise<T> {
  content: T | undefined
  isPending: boolean
  isSettled: boolean
  isRejected: boolean
  isFulfilled: boolean
}

function findDoc<K extends keyof DocumentTypes>(
  modelType: K,
  id: string | number
): DocumentPromise<DocumentTypes[K]>
```

## Implementation Details

### Core AppStore Class

```typescript
import { createStore, computed } from '@supergrain/core'

class AppStore {
  private store: AppStoreState
  private update: (ops: any) => void

  constructor() {
    const [store, update] = createStore<AppStoreState>({
      documents: {},
    })
    this.store = store
    this.update = update
  }

  findDoc<K extends keyof DocumentTypes>(
    modelType: K,
    id: string | number
  ): DocumentPromise<DocumentTypes[K]> {
    const key = String(id)

    const documentState = computed(() => {
      return this.store.documents[modelType]?.[key]
    })

    // If document doesn't exist, trigger fetch and create pending entry
    if (!documentState()?.value) {
      this.triggerFetch(modelType, id)
      this.update({
        $set: {
          [`documents.${modelType}.${key}`]: {
            content: undefined,
            status: 'pending',
          },
        },
      })
    }

    return new DocumentPromise(documentState)
  }

  insertDocument<K extends keyof DocumentTypes>(
    modelType: K,
    data: Partial<DocumentTypes[K]>
  ): Promise<DocumentTypes[K]> {
    // Handles optimistic updates and actual insertion
  }

  private triggerFetch(modelType: string, id: string | number) {
    // Placeholder -- user implements actual fetching
  }
}
```

### DocumentPromise Implementation

```typescript
class DocumentPromise<T> {
  private documentState: () => DocumentState<T> | undefined

  constructor(documentState: () => DocumentState<T> | undefined) {
    this.documentState = documentState
  }

  get content(): T | undefined {
    return this.documentState()?.content
  }

  get isPending(): boolean {
    return this.documentState()?.status === 'pending'
  }

  get isSettled(): boolean {
    const status = this.documentState()?.status
    return status === 'fulfilled' || status === 'rejected'
  }

  get isRejected(): boolean {
    return this.documentState()?.status === 'rejected'
  }

  get isFulfilled(): boolean {
    return this.documentState()?.status === 'fulfilled'
  }
}
```

### React Integration

```typescript
function useAppStore() {
  return useTracked(appStore.store)
}

function MyComponent() {
  useAppStore()

  const post = findDoc("posts", 1)
  const user = findDoc("users", post.content?.userId)

  if (post.isPending) return <div>Loading post...</div>
  if (post.isRejected) return <div>Error loading post</div>

  return (
    <div>
      <h1>{post.content?.title}</h1>
      {user.content && <p>By: {user.content.firstName}</p>}
    </div>
  )
}
```

## File Structure

```
packages/
  store/
    src/
      index.ts              # Main exports
      store.ts              # AppStore class
      document-promise.ts   # DocumentPromise implementation
      types.ts              # TypeScript interfaces
      react.ts              # React integration hooks
    tests/
      store.test.ts
      react.test.tsx
    package.json
```

## Implementation Phases

### Phase 1: Core Store Structure
- AppStore class wrapping Supergrain core
- DocumentPromise reactive wrapper
- Basic `findDoc` with caching and pending states

### Phase 2: Document Operations
- `insertDocument` with optimistic updates and rollback

### Phase 3: Advanced Features (Future)
- TTL and cache eviction
- Local storage integration
- Cache invalidation strategies

## Known Risks

1. **Memory** -- single store with all documents could grow large (mitigate with TTL/eviction)
2. **Complex cross-document updates** -- mitigate with MongoDB-style operators
3. **DX** -- needs good error messages and debugging tools
