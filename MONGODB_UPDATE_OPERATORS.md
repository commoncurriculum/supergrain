# MongoDB Update Operators for Storable

## AI Assistant Implementation Instructions

**IMPORTANT**: Please implement the MongoDB-style update operators as specified in this document. Update this checklist as you complete each task by changing `[ ]` to `[x]`.

### Implementation Checklist

#### Phase 1: Core Setup

- [ ] Create `packages/core/src/operators.ts` file
- [ ] Implement path resolution utilities (`resolvePath`, `setPath`, `deletePath`)
- [ ] Create the main `update()` function with batching support
- [ ] Add proper TypeScript types for `UpdateOperations`

#### Phase 2: Basic Operators

- [ ] Implement `$set` operator
- [ ] Implement `$unset` operator
- [ ] Implement `$inc` operator
- [ ] Implement `$push` operator (basic version)
- [ ] Implement `$pull` operator

#### Phase 3: Extended Operators

- [ ] Implement `$mul` operator
- [ ] Implement `$pop` operator
- [ ] Implement `$addToSet` operator
- [ ] Implement `$rename` operator
- [ ] Implement `$min` and `$max` operators

#### Phase 4: Advanced Array Features

- [ ] Add `$each` modifier support for `$push` and `$addToSet`
- [ ] Add `$position` modifier for `$push`
- [ ] Add `$slice` modifier for `$push`
- [ ] Add `$sort` modifier for `$push`

#### Phase 5: Testing & Integration

- [ ] Create test file `packages/core/src/operators.test.ts`
- [ ] Write unit tests for each operator
- [ ] Test with reactive proxies from `createStore`
- [ ] Verify signal triggering and batching
- [ ] Add performance benchmarks

#### Phase 6: Documentation

- [ ] Add JSDoc comments to all exported functions
- [ ] Update main README with usage examples
- [ ] Create TypeScript type utilities for better type inference

### Key Requirements

1. **Import and use existing functions**: Use `startBatch()` and `endBatch()` from the existing store implementation
2. **Maintain reactivity**: All mutations must work through the proxy to trigger signals
3. **Handle dot notation**: Support paths like `'author.name'` and `'tags.0'`
4. **Type safety**: Provide TypeScript types but don't over-complicate initially
5. **No external dependencies**: Build everything using vanilla JavaScript/TypeScript

## Overview

This document outlines the implementation of MongoDB-style update operators for Storable's reactive objects. The focus is on providing a clean, functional API that works with the existing proxy-based reactive system.

## Core API Design

### Primary Update Function

```typescript
import { update } from '@storable/core'

// Update any reactive object from the store
const post = store.get('posts').get('1')
update(post, {
  $set: { title: 'New Title' },
  $inc: { viewCount: 1 },
  $push: { tags: 'featured' },
})
```

### Key Design Decisions

1. **Functional Approach**: `update(target, operations)` instead of methods on the proxy
2. **Works with ANY reactive object**: Not tied to a specific store structure
3. **Maintains reactivity**: All updates trigger appropriate signals
4. **Type-safe**: Full TypeScript support with proper inference

## Implementation Architecture

**Note to implementer**: Start by creating this file exactly as shown, then extend it with the operator implementations below.

### 1. Update Operators Module (`packages/core/src/operators.ts`)

```typescript
// Core types
export interface UpdateOperations {
  $set?: Record<string, any>
  $unset?: Record<string, true>
  $inc?: Record<string, number>
  $mul?: Record<string, number>
  $push?: Record<string, any>
  $pull?: Record<string, any>
  $pop?: Record<string, 1 | -1>
  $addToSet?: Record<string, any>
  $rename?: Record<string, string>
  $min?: Record<string, any>
  $max?: Record<string, any>
}

// Import batching from existing store
import { startBatch, endBatch } from './store'

// Main update function
export function update<T extends object>(
  target: T,
  operations: UpdateOperations
): void {
  startBatch()
  try {
    // Apply each operator in order
    for (const [operator, value] of Object.entries(operations)) {
      if (operators[operator]) {
        operators[operator](target, value)
      } else {
        throw new Error(`Unknown operator: ${operator}`)
      }
    }
  } finally {
    endBatch()
  }
}
```

### 2. Path Resolution Utilities

```typescript
// Handle dot notation paths
function resolvePath(
  obj: any,
  path: string
): { parent: any; key: string; value: any } {
  const parts = path.split('.')
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current)) {
      current[part] = {}
    }
    current = current[part]
  }

  const key = parts[parts.length - 1]
  return { parent: current, key, value: current[key] }
}

// Set value at path
function setPath(obj: any, path: string, value: any): void {
  const { parent, key } = resolvePath(obj, path)
  parent[key] = value
}

// Delete path
function deletePath(obj: any, path: string): void {
  const { parent, key } = resolvePath(obj, path)
  delete parent[key]
}
```

### 3. Operator Implementations

```typescript
// Helper function for deep equality (implement or import from a utility)
function isEqual(a: any, b: any): boolean {
  // Simple implementation - enhance as needed
  return JSON.stringify(a) === JSON.stringify(b)
}

const operators: Record<string, (target: any, value: any) => void> = {
  $set(target: any, updates: Record<string, any>) {
    for (const [path, value] of Object.entries(updates)) {
      setPath(target, path, value)
    }
  },

  $unset(target: any, paths: Record<string, true>) {
    for (const path of Object.keys(paths)) {
      deletePath(target, path)
    }
  },

  $inc(target: any, increments: Record<string, number>) {
    for (const [path, amount] of Object.entries(increments)) {
      const { parent, key, value } = resolvePath(target, path)
      parent[key] = (value || 0) + amount
    }
  },

  $push(target: any, pushes: Record<string, any>) {
    for (const [path, value] of Object.entries(pushes)) {
      const { parent, key } = resolvePath(target, path)
      if (!Array.isArray(parent[key])) {
        parent[key] = []
      }
      if (typeof value === 'object' && '$each' in value) {
        parent[key].push(...value.$each)
      } else {
        parent[key].push(value)
      }
    }
  },

  $pull(target: any, pulls: Record<string, any>) {
    for (const [path, value] of Object.entries(pulls)) {
      const { parent, key } = resolvePath(target, path)
      if (Array.isArray(parent[key])) {
        parent[key] = parent[key].filter(item => !isEqual(item, value))
      }
    }
  },

  $pop(target: any, pops: Record<string, 1 | -1>) {
    for (const [path, direction] of Object.entries(pops)) {
      const { parent, key } = resolvePath(target, path)
      if (Array.isArray(parent[key])) {
        if (direction === 1) {
          parent[key].pop()
        } else {
          parent[key].shift()
        }
      }
    }
  },

  $addToSet(target: any, additions: Record<string, any>) {
    for (const [path, value] of Object.entries(additions)) {
      const { parent, key } = resolvePath(target, path)
      if (!Array.isArray(parent[key])) {
        parent[key] = []
      }
      const arr = parent[key]
      if (typeof value === 'object' && '$each' in value) {
        for (const item of value.$each) {
          if (!arr.some(existing => isEqual(existing, item))) {
            arr.push(item)
          }
        }
      } else if (!arr.some(existing => isEqual(existing, value))) {
        arr.push(value)
      }
    }
  },
}
```

## Usage Examples

### Basic Field Updates

```typescript
const user = store.get('users').get('1')

// Set single field
update(user, {
  $set: { name: 'Jane Doe' },
})

// Set nested field
update(user, {
  $set: { 'profile.bio': 'New bio text' },
})

// Multiple operations
update(user, {
  $set: { lastActive: new Date() },
  $inc: { loginCount: 1 },
})
```

### Array Operations

```typescript
const post = store.get('posts').get('1')

// Add to array
update(post, {
  $push: { tags: 'javascript' },
})

// Add multiple items
update(post, {
  $push: {
    tags: { $each: ['react', 'vue'] },
  },
})

// Remove from array
update(post, {
  $pull: { tags: 'deprecated' },
})

// Add unique items only
update(post, {
  $addToSet: {
    categories: { $each: ['tech', 'web'] },
  },
})
```

### Numeric Operations

```typescript
const product = store.get('products').get('1')

// Increment/decrement
update(product, {
  $inc: {
    stock: -1, // Decrement
    soldCount: 1, // Increment
  },
})

// Multiply
update(product, {
  $mul: { price: 0.9 }, // 10% discount
})

// Min/max (conditional updates)
update(product, {
  $min: { lowestPrice: 19.99 }, // Only update if new value is lower
  $max: { highestBid: 25.0 }, // Only update if new value is higher
})
```

## Integration with Store Architecture

### Current Store Structure

```typescript
// Your proposed architecture
const store = new Map()
store.set('posts', new Map())
store.get('posts').set('1', createStore(post1Object))

// The update function works with the reactive objects
const post = store.get('posts').get('1')
update(post, { $set: { title: 'New' } })
```

### React Integration

```typescript
function useMongoUpdate() {
  return useCallback((target: any, ops: UpdateOperations) => {
    // Could wrap in batch for performance
    startBatch()
    try {
      update(target, ops)
    } finally {
      endBatch()
    }
  }, [])
}

// In component
function PostEditor({ postId }) {
  const post = useFind(store, 'posts', postId)
  const mongoUpdate = useMongoUpdate()

  const handlePublish = () => {
    mongoUpdate(post, {
      $set: {
        status: 'published',
        publishedAt: new Date(),
      },
      $inc: { version: 1 },
    })
  }
}
```

## Implementation Phases

### Phase 1: Core Operators (Priority)

- [x] `$set` - Set field values
- [x] `$unset` - Remove fields
- [x] `$inc` - Increment numbers
- [x] `$push` - Add to arrays
- [x] `$pull` - Remove from arrays

### Phase 2: Extended Operators

- [ ] `$mul` - Multiply numbers
- [ ] `$pop` - Remove first/last array element
- [ ] `$addToSet` - Add unique elements
- [ ] `$rename` - Rename fields
- [ ] `$min/$max` - Conditional updates

### Phase 3: Advanced Features

- [ ] `$each` modifier for batch operations
- [ ] `$position` modifier for array insertion
- [ ] `$slice` modifier to limit array size
- [ ] `$sort` modifier to sort after update

## Type Safety

```typescript
// Strongly typed operations
type MongoUpdate<T> = {
  $set?: DeepPartial<T>
  $unset?: PathsToBoolean<T>
  $inc?: NumericPaths<T>
  $push?: ArrayElementPaths<T>
  // etc...
}

// Usage with types
interface Post {
  title: string
  views: number
  tags: string[]
}

const post: Post = store.get('posts').get('1')

update<Post>(post, {
  $set: { title: 'New' }, // ✓ OK
  $inc: { views: 1 }, // ✓ OK
  $inc: { title: 1 }, // ✗ Type error: title is not numeric
  $push: { tags: 'new' }, // ✓ OK
})
```

## Benefits of This Approach

1. **Clean Separation**: Update logic separate from proxy implementation
2. **Flexibility**: Works with any reactive object, not tied to specific store
3. **Familiar API**: MongoDB developers instantly understand it
4. **Performance**: Can batch operations efficiently
5. **Type Safety**: Full TypeScript support
6. **Testable**: Pure functions that can be tested in isolation

## Next Steps

1. Implement core operators in `packages/core/src/operators.ts`
2. Add comprehensive tests for each operator
3. Create TypeScript type utilities for type safety
4. Add React/Vue helper hooks
5. Write documentation and examples
6. Benchmark against direct mutations

## Notes

- All operations maintain fine-grained reactivity through the existing proxy system
- Operations are synchronous (like MongoDB's in-memory updates)
- Can be extended with custom operators if needed
- Compatible with existing direct mutation approach
