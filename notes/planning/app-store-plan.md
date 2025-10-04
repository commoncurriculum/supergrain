# App-Level Store Planning Document

## Overview

This document outlines the design for a new app-level store that builds on top of the existing Supergrain library. The goal is to create a document-oriented store that provides a simple API for finding and inserting documents by type and ID, with full TypeScript support and reactive capabilities.

## API Requirements

The desired API should look like this:

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

Where `findDoc` returns a promise-like object with:

- `content`: The actual document data (or undefined if not loaded/found)
- `isPending`: Boolean indicating if the request is in progress
- `isSettled`: Boolean indicating if the request has completed (success or failure)
- `isRejected`: Boolean indicating if the request failed
- `isFulfilled`: Boolean indicating if the request succeeded

## Architecture Decision: Store Structure

After analyzing the requirements, I recommend **Option 2: Single Supergrain Store** over a Map<string, Store> approach.

### Why Single Store Approach?

1. **Unified Reactivity**: All documents live in one reactive store, enabling cross-document dependencies
2. **Better Performance**: Single subscription system instead of managing multiple store subscriptions
3. **Simpler State Management**: One update function, one source of truth
4. **Atomic Operations**: Can update multiple document types in a single batched operation
5. **Easier Testing**: Single store to mock and test

### Store Structure

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
  // Future: could add global app state here
  // ui: { ... }
  // settings: { ... }
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

### Model Type Registry

```typescript
// User defines their models
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

// Global type registry - user declares this in their app
interface DocumentTypes {
  users: User
  posts: Post
  // ... other models
}

// This provides full type safety
```

### Promise-like Return Type

```typescript
interface DocumentPromise<T> {
  content: T | undefined
  isPending: boolean
  isSettled: boolean
  isRejected: boolean
  isFulfilled: boolean
}

// Type-safe findDoc function
function findDoc<K extends keyof DocumentTypes>(
  modelType: K,
  id: string | number
): DocumentPromise<DocumentTypes[K]>
```

## Implementation Plan

### Phase 1: Core Store Structure

1. **Create AppStore class**
   - Wraps the core Supergrain store
   - Manages document lifecycle (pending -> fulfilled/rejected)
   - Handles type mapping and validation

2. **Implement DocumentPromise wrapper**
   - Reactive object that tracks document state
   - Automatically updates when document changes
   - Provides clean promise-like API

3. **Basic findDoc implementation**
   - Returns immediately with cached data if available
   - Returns pending state for uncached data
   - Triggers fetch process (placeholder for now)

### Phase 2: Document Operations

1. **Implement insertDocument**

   ```typescript
   insertDocument('users', { firstName: 'John', lastName: 'Doe' })
   ```

2. **Handle optimistic updates for insertDocument**
   - Immediate UI updates
   - Rollback on failure

### Phase 3: Advanced Features (Future)

1. **Caching and persistence**
   - TTL for documents
   - Local storage integration
   - Cache invalidation strategies

2. **Optimistic updates**
   - Immediate UI updates for insertDocument
   - Rollback on failure

## Detailed Implementation

### Core AppStore Class

```typescript
import { createStore } from '@supergrain/core'
import { computed } from '@supergrain/core'

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

    // Create reactive computed that tracks this document
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

    // Return promise-like interface
    return new DocumentPromise(documentState)
  }

  insertDocument<K extends keyof DocumentTypes>(
    modelType: K,
    data: Partial<DocumentTypes[K]>
  ): Promise<DocumentTypes[K]> {
    // Implementation will handle optimistic updates
    // and actual insertion logic
  }

  private triggerFetch(modelType: string, id: string | number) {
    // Placeholder - user will implement actual fetching
    // This could dispatch to a fetch queue, call APIs, etc.
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
// Hook for using the app store
function useAppStore() {
  return useTrackedStore(appStore.store)
}

// Usage in components
function MyComponent() {
  useAppStore() // Track changes

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
      store.ts          # AppStore class
      document-promise.ts   # DocumentPromise implementation
      types.ts              # TypeScript interfaces
      react.ts              # React integration hooks
    tests/
      store.test.ts
      react.test.tsx
    package.json
```

## Benefits of This Approach

1. **Type Safety**: Full TypeScript support with model registry
2. **Reactive**: Built on proven Supergrain reactivity system
3. **Performance**: Fine-grained updates, only affected components re-render
4. **Simple**: Focused API - just findDoc by ID and insertDocument
5. **Familiar**: Promise-like API that developers expect
6. **Testable**: Clear separation of concerns, easy to mock

## Potential Challenges

1. **Memory Usage**: Storing all documents in one store could grow large
   - Mitigation: Add TTL and cache eviction strategies

2. **Complex State Updates**: Cross-document updates might be complex
   - Mitigation: Use MongoDB-style operators for atomic updates

3. **Developer Experience**: Need good error messages and debugging
   - Mitigation: Add developer tools and clear error handling

## Next Steps

1. Create the basic AppStore implementation
2. Implement DocumentPromise with core reactive features
3. Add React hooks for integration
4. Create comprehensive tests
5. Build example application to validate API
6. Add caching and persistence as needed

This approach provides a focused, simple document store for local-first apps while leveraging the existing Supergrain library's proven reactivity system. The API is intentionally minimal - just fetching documents by ID and inserting new ones.
