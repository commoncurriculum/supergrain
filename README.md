# Storable

A reactive store library with fine-grained reactivity powered by alien-signals. Create stores that track property access and update components with surgical precision using MongoDB-style update operators.

_Core Implementation: [packages/core/src](packages/core/src) | React Integration: [packages/react/src](packages/react/src) | App Store: [packages/app-store/src](packages/app-store/src) | Examples: [packages/react/examples](packages/react/examples)_

## Features

- 🎯 **Fine-grained reactivity** - Only components using changed data re-render
- 🔄 **MongoDB-style operators** - Powerful update operations with automatic batching
- 📦 **Zero boilerplate** - No actions, reducers, or decorators required
- ⚛️ **React integration** - Simple hooks for reactive components
- 📝 **Full TypeScript support** - Complete type safety and inference
- 🗂️ **Document-oriented store** - App-level store for document management with promise-like API

## Installation

_Package definitions: [core/package.json](packages/core/package.json) | [react/package.json](packages/react/package.json) | [app-store/package.json](packages/app-store/package.json)_

```bash
# Core reactive store
npm install @storable/core @storable/react

# App-level document store (optional)
npm install @storable/app-store

# or with pnpm
pnpm add @storable/core @storable/react @storable/app-store
```

## Quick Start

_Implementation: [createStore](packages/core/src/store.ts) | [useTrackedStore](packages/react/src/use-store.ts) | Tests: [todo.test.ts](packages/core/tests/todo.test.ts)_

```typescript
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'

// Create a store with initial state
const [store, update] = createStore({
  count: 0,
  todos: [],
})

// Use in React components
function TodoApp() {
  const state = useTrackedStore(store)

  // Updates MUST use the update function with operators
  const addTodo = (text: string) => {
    update({
      $push: {
        todos: { id: Date.now(), text, completed: false }
      }
    })
  }

  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button onClick={() => update({ $inc: { count: 1 } })}>
        Increment
      </button>

      <input
        onKeyPress={(e) => e.key === 'Enter' && addTodo(e.target.value)}
        placeholder="Add todo..."
      />

      {state.todos.map(todo => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </div>
  )
}
```

## Key Concepts

### Read-Only State

```typescript
const [state, update] = createStore({ count: 0 })

// ✅ Reading is fine
console.log(state.count)

// ❌ Direct mutation throws an error
state.count = 5 // Error!

// ✅ Use update function instead
update({ $set: { count: 5 } })
```

### MongoDB-Style Operators

_Implementation: [operators.ts](packages/core/src/operators.ts) | Tests: [operators.test.ts](packages/core/tests/operators.test.ts)_

```typescript
// Set values
update({ $set: { 'user.name': 'Jane' } })

// Increment numbers
update({ $inc: { count: 1 } })

// Array operations
update({ $push: { items: 'newItem' } })
update({ $pull: { items: 'oldItem' } })

// Multiple operations (batched automatically)
update({
  $set: { title: 'New Title' },
  $inc: { views: 1 },
  $push: { tags: 'featured' },
})
```

### Fine-Grained Reactivity

_Example: [nested-components.tsx](packages/react/examples/nested-components.tsx) | Tests: [use-store.test.tsx](packages/react/tests/use-store.test.tsx)_

```typescript
function ComponentA() {
  const state = useTrackedStore(store)
  // Only re-renders when 'x' changes
  return <div>X: {state.x}</div>
}

function ComponentB() {
  const state = useTrackedStore(store)
  // Only re-renders when 'y' changes
  return <div>Y: {state.y}</div>
}

// Updating 'z' won't re-render either component
update({ $set: { z: 10 } })
```

### Using with Memoized Components

_Tests: [deep-nesting.test.tsx](packages/react/tests/deep-nesting.test.tsx)_

For optimal performance with complex component hierarchies, call `useTrackedStore` inside each memoized component rather than passing state as props:

```typescript
import React, { memo } from 'react'

// ✅ Correct - useTrackedStore inside memoized component
const TaskComponent = memo(({ store, taskId }) => {
  const state = useTrackedStore(store)
  const task = state.tasks.find(t => t.id === taskId)

  return (
    <div>
      <h3>{task.title}</h3>
      <span>{task.completed ? '✓' : '○'}</span>
    </div>
  )
})

// ❌ Incorrect - passing state as prop breaks memoization
const TaskComponent = memo(({ state, taskId }) => {
  const task = state.tasks.find(t => t.id === taskId)
  // This will re-render on every state change because state object reference changes
  return <div>{task.title}</div>
})

// Usage
function ProjectView() {
  const state = useTrackedStore(store)

  return (
    <div>
      {state.project.taskIds.map(taskId => (
        <TaskComponent key={taskId} store={store} taskId={taskId} />
      ))}
    </div>
  )
}
```

**Benefits of this pattern:**

- Only components accessing changed data re-render
- React.memo works effectively with fine-grained subscriptions
- Deep nested updates don't cause cascade re-renders
- Maintains optimal performance even with complex component trees

### For Component - Optimized Array Rendering

_Implementation: [use-store.ts](packages/react/src/use-store.ts) | Tests: [render-analysis.test.tsx](packages/react/tests/render-analysis.test.tsx)_

The `For` component provides optimal performance for rendering arrays by automatically handling version props for React.memo components:

```typescript
import { For } from '@storable/react'

// Memoized component for each item
const TodoItem = memo(({ todo }) => (
  <div className={todo.completed ? 'completed' : ''}>
    {todo.text}
    <button onClick={() => toggleTodo(todo.id)}>Toggle</button>
  </div>
))

function TodoList() {
  const state = useTrackedStore(store)

  return (
    <For each={state.todos} fallback={<div>No todos yet</div>}>
      {(todo, index) => (
        <TodoItem key={todo.id} todo={todo} />
      )}
    </For>
  )
}
```

**Benefits:**

- Automatically passes version information to enable React.memo optimization
- Uses stable keys (item.id if available, otherwise index)
- Only re-renders items whose data actually changed
- Supports fallback content for empty arrays

### Document-Oriented App Store

_Implementation: [app-store.ts](packages/app-store/src/app-store.ts) | Tests: [app-store.test.ts](packages/app-store/tests/app-store.test.ts)_

For app-level document management with a promise-like API:

```typescript
import { AppStore } from '@storable/app-store'

// Define your document types
interface DocumentTypes {
  users: { id: number; firstName: string; lastName: string; email: string }
  posts: { id: number; title: string; content: string; userId: number }
}

// Create app store with optional fetch handler
const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
  const response = await fetch(`/api/${modelType}/${id}`)
  return response.json()
})

function MyComponent() {
  // Documents are fetched automatically and cached
  const post = appStore.findDoc("posts", 1)
  const user = appStore.findDoc("users", post.content?.userId)

  if (post.isPending) return <div>Loading post...</div>
  if (post.isRejected) return <div>Error loading post</div>

  return (
    <article>
      <h1>{post.content?.title}</h1>
      {user.content && <p>By: {user.content.firstName} {user.content.lastName}</p>}
    </article>
  )
}

// Insert new documents
await appStore.insertDocument('users', {
  id: 2,
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com'
})
```

## Documentation

📖 **[Complete Documentation & Examples → USAGE.md](USAGE.md)**

The USAGE.md file contains:

- Comprehensive tutorials and examples
- Complete API reference
- Building a full TODO app
- App Store document management patterns
- Performance optimization tips
- Advanced patterns and best practices
- TypeScript usage

## License

MIT
