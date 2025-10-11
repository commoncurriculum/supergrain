# Supergrain

A reactive store library with super fine-grained reactivity powered by alien-signals. Create stores that track property access and update components with surgical precision using MongoDB-style update operators.

📚 **[View Full Documentation](https://commoncurriculum.github.io/supergrain/)** | _Core Implementation: [packages/core/src](packages/core/src) | React Integration: [packages/react/src](packages/react/src) | Store: [packages/store/src](packages/store/src) | Examples: [packages/react/examples](packages/react/examples)_

## Features

- 🎯 **Super fine-grained reactivity** - Only components using changed data re-render
- 🔄 **MongoDB-style operators** - Powerful update operations with automatic batching
- 📦 **Zero boilerplate** - No actions, reducers, or decorators required
- ⚛️ **React integration** - Simple hooks for reactive components
- 📝 **Full TypeScript support** - Complete type safety and inference
- 🗂️ **Document-oriented store** - App-level store for document management with promise-like API

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Creating Stores](#creating-stores)
- [Reading State](#reading-state)
- [Updating State](#updating-state)
- [React Integration](#react-integration)
- [MongoDB-Style Operators](#mongodb-style-operators)
- [Effects and Computed Values](#effects-and-computed-values)
- [Store - Document Management](#store---document-management)
- [Building a TODO App](#building-a-todo-app)
- [TypeScript](#typescript)
- [Performance Tips](#performance-tips)

## Installation

_Package definitions: [core/package.json](packages/core/package.json) | [react/package.json](packages/react/package.json) | [store/package.json](packages/store/package.json)_

```bash
# Core reactive store
npm install @supergrain/core @supergrain/react

# App-level document store (optional)
npm install @supergrain/store

# or with pnpm
pnpm add @supergrain/core @supergrain/react @supergrain/store
```

## Quick Start

_Links: [Source Code](packages/core/src/store.ts). [Tests](packages/core/tests/todo.test.ts)._

```typescript
// [#DOC_TEST_3](packages/documentation/tests/quick-start.test.tsx)

import { createStore } from '@supergrain/core'
import { useTrackedStore } from '@supergrain/react'

// Create a store with initial state
const [store, update] = createStore({
  count: 0,
  todos: [],
})

// Use in React components
function TodoApp() {
  const state = useTrackedStore(store)

  // Use update function with MongoDB-style operators
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

## How It Works

Supergrain uses **super fine-grained reactivity** powered by `alien-signals` to automatically track which components access which data, creating subscriptions only to properties that are actually used.

### The Magic of `useTrackedStore`

When you call `useTrackedStore(store)` in a React component, it:

1. **Creates an effect context** using `alien-signals`
2. **Returns a proxy** of your store that tracks property access
3. **Automatically subscribes** to any properties accessed during render
4. **Re-renders the component** only when subscribed properties change

```typescript
// [#DOC_TEST_28](packages/documentation/tests/readme-examples.test.tsx)

function MyComponent() {
  const state = useTrackedStore(store) // Creates reactive proxy

  // This creates a subscription to 'user.profile.name'
  const name = state.user.profile.name

  // This creates a subscription to 'items[0].title'
  const firstTitle = state.items[0].title

  return <div>{name}: {firstTitle}</div>
}

// Later, when you update:
update({ $set: { 'user.profile.name': 'Jane' } }) // Only this component re-renders
update({ $set: { 'user.profile.age': 30 } })     // This component does NOT re-render
```

### Property Access = Subscription

Every property you access during render creates a subscription. The reactivity system:

- ✅ `state.items[0].name` creates subscription to ONLY the `name` property
- ✅ `state.items.map(item => item.title)` creates subscriptions to each item's `title` property
- ✅ Deeply nested access like `state.a.b.c.d.e` works perfectly
- ✅ Accessing `state.items[0].name` will NOT re-render when `state.items[0].age` changes (property-level granularity)

### No Manual Subscription Management

Unlike other reactive systems, you never need to manually subscribe or unsubscribe:

```typescript
// [#DOC_TEST_29](packages/documentation/tests/readme-examples.test.tsx)

// ❌ Other libraries require manual subscriptions
const unsubscribe = store.subscribe('user.name', callback)
useEffect(() => unsubscribe, [])

// ✅ Supergrain: just access the data normally
const userName = useTrackedStore(store).user.name // Automatically subscribed!
```

## Creating Stores

_Links: [Source Code](packages/core/src/store.ts). [Tests](packages/core/tests/store.test.ts)._

**Simple Document**

```typescript
// [#DOC_TEST_1](packages/documentation/tests/creating-stores.test.ts)

import { createStore } from '@supergrain/core'

const [state, update] = createStore({
  count: 0,
  name: 'John',
})
```

**With nested objects:**

```typescript
// [#DOC_TEST_2](packages/documentation/tests/creating-stores.test.ts)

import { createStore } from '@supergrain/core'

const [state, update] = createStore({
  users: [
    {
      id: 1,
      name: 'Alice',
      todos: [
        {
          id: 1,
          text: 'Use Supergrain.',
          tags: [
            {
              id: 1,
              title: 'Urgent.',
            },
          ],
        },
      ],
      address: {
        city: 'New York',
        zip: '10001',
      },
    },
  ],
})
```

## Reading State

_Links: [Source Code](packages/core/src/store.ts). [Tests](packages/core/tests/store.test.ts)._

The state object is a reactive proxy that tracks property access:

```typescript
// [#DOC_TEST_4](packages/documentation/tests/read-only-state.test.ts)

const [state, update] = createStore({ count: 0, name: 'John' })

// You can read properties normally
console.log(state.count) // 0
console.log(state.name) // 'John'

// Direct mutations are supported
state.count = 5 // ✅ Works fine!
state.name = 'Jane' // ✅ Works fine!

// Update function also works
update({ $set: { count: 10, name: 'Bob' } })
```

## Updating State

_Links: [Source Code](packages/core/src/operators.ts). [Tests](packages/core/tests/operators.test.ts)._

State can be updated in two ways: direct mutations or the `update` function with MongoDB-style operators:

**Option 1: Direct mutations (simpler syntax)**

```typescript
// [#DOC_TEST_30](packages/documentation/tests/readme-core.test.ts)

const [state, update] = createStore({
  count: 0,
  user: { name: 'John', age: 30 },
  items: ['a', 'b', 'c'],
})

// Direct mutations work perfectly
state.count = 5
state.user.name = 'Jane'
state.user.age = 35
state.items.push('d')
```

**Option 2: Update function with MongoDB-style operators**

```typescript
// [#DOC_TEST_5](packages/documentation/tests/mongodb-operators.test.ts)

// Set values
update({ $set: { count: 5 } })
update({ $set: { 'user.name': 'Jane' } }) // Dot notation for nested

// Increment numbers
update({ $inc: { count: 1 } })
update({ $inc: { 'user.age': 5 } })

// Array operations
update({ $push: { items: 'd' } })
update({ $pull: { items: 'b' } })

// Multiple operations in one call (batched)
update({
  $set: { 'user.name': 'Bob' },
  $inc: { count: 2 },
  $push: { items: 'e' },
})
```

## React Integration

_Links: [Source Code](packages/react/src/use-store.ts). [Tests](packages/react/tests/use-store.test.tsx). [Examples](packages/react/examples/nested-components.tsx)._

### useTrackedStore Hook

The primary way to use stores in React:

```typescript
// [#DOC_TEST_6](packages/documentation/tests/react-integration.test.tsx)

import { useTrackedStore } from '@supergrain/react'

function Counter() {
  const state = useTrackedStore(store)

  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => update({ $inc: { count: 1 } })}>
        Increment
      </button>
    </div>
  )
}
```

### Super Fine-grained Reactivity

Components only re-render when properties they access change:

```typescript
// [#DOC_TEST_8](packages/documentation/tests/react-integration.test.tsx)

const [state, update] = createStore({
  x: 1,
  y: 2,
  z: 3
})

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

// Updating 'z' won't re-render ComponentA or ComponentB
update({ $set: { z: 10 } })
```

### Using with Memoized Components

Because values are proxies and they're stable across renders, passing them will break memoized components (as the proxy won't change when the values do). To solve this, call `useTrackedStore` inside each memoized component rather than passing state as props:

```typescript
// [#DOC_TEST_9](packages/documentation/tests/react-integration.test.tsx)

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

### For Component - Optimized Array Rendering

_Links: [Source Code](packages/react/src/use-store.ts). [Tests](packages/react/tests/render-analysis.test.tsx)._

The `For` component provides optimal performance for rendering arrays by automatically handling version props for React.memo components:

```typescript
// [#DOC_TEST_10](packages/documentation/tests/react-integration.test.tsx)

import { For } from '@supergrain/react'

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

## MongoDB-Style Operators

_Links: [Source Code](packages/core/src/operators.ts). [Tests](packages/core/tests/operators.test.ts)._

### $set - Set field values

```typescript
// [#DOC_TEST_11](packages/documentation/tests/mongodb-operators.test.ts)

update({ $set: { count: 10 } })
update({ $set: { 'user.name': 'Alice' } }) // Nested with dot notation
update({
  $set: {
    'user.name': 'Bob',
    'user.age': 25,
    'settings.theme': 'dark',
  },
})
```

### $unset - Remove fields

```typescript
// [#DOC_TEST_12](packages/documentation/tests/mongodb-operators.test.ts)

update({ $unset: { temporaryField: 1 } })
update({ $unset: { 'user.middleName': 1 } })
```

### $inc - Increment numeric values

```typescript
// [#DOC_TEST_13](packages/documentation/tests/mongodb-operators.test.ts)

update({ $inc: { count: 1 } })
update({ $inc: { count: -5 } }) // Decrement
update({ $inc: { 'stats.views': 10 } })
```

### $push - Add to arrays

```typescript
// [#DOC_TEST_14](packages/documentation/tests/mongodb-operators.test.ts)

update({ $push: { items: 'newItem' } })

// Add multiple items with $each
update({
  $push: {
    items: { $each: ['item1', 'item2', 'item3'] },
  },
})
```

### $pull - Remove from arrays

```typescript
// [#DOC_TEST_15](packages/documentation/tests/mongodb-operators.test.ts)

// Remove by value
update({ $pull: { items: 'itemToRemove' } })

// Remove objects by matching properties
update({
  $pull: {
    users: { id: 123, name: 'John' },
  },
})
```

### $addToSet - Add unique elements to arrays

```typescript
// [#DOC_TEST_16](packages/documentation/tests/mongodb-operators.test.ts)

update({ $addToSet: { tags: 'newTag' } }) // Won't add if already exists

// Add multiple unique items
update({
  $addToSet: {
    tags: { $each: ['tag1', 'tag2', 'tag3'] },
  },
})
```

### $rename - Rename fields

```typescript
// [#DOC_TEST_17](packages/documentation/tests/mongodb-operators.test.ts)

update({ $rename: { oldFieldName: 'newFieldName' } })
update({ $rename: { 'user.firstName': 'user.name' } })
```

### $min/$max - Conditional updates

```typescript
// [#DOC_TEST_18](packages/documentation/tests/mongodb-operators.test.ts)

// Only updates if new value is smaller
update({ $min: { lowestScore: 50 } })

// Only updates if new value is larger
update({ $max: { highestScore: 100 } })
```

## Effects and Computed Values

_Links: [Source Code](packages/core/src/index.ts). [Examples](packages/core/benchmarks/additional.bench.ts)._

### Effects

React to state changes with `effect`:

```typescript
// [#DOC_TEST_19](packages/documentation/tests/effects.test.ts)

import { effect } from '@supergrain/core'

const [state, update] = createStore({ count: 0 })

// This runs whenever count changes
effect(() => {
  console.log('Count changed to:', state.count)
})

// Save to localStorage on change
effect(() => {
  localStorage.setItem('count', String(state.count))
})
```

### Computed Values

Derive values that update automatically:

```typescript
// [#DOC_TEST_20](packages/documentation/tests/computed.test.ts)

import { computed } from '@supergrain/core'

const [state, update] = createStore({
  todos: [
    { id: 1, text: 'Task 1', completed: false },
    { id: 2, text: 'Task 2', completed: true },
  ],
})

const completedCount = computed(
  () => state.todos.filter(t => t.completed).length
)

console.log(completedCount()) // 1

// Updates automatically when todos change
update({
  $set: { 'todos.0.completed': true },
})

console.log(completedCount()) // 2
```

## Store - Document Management

_Links: [Source Code](packages/store/src/store.ts)._

The `@supergrain/store` package provides a document-oriented store built on top of the core Supergrain reactivity system. It's designed for managing app-level data with a promise-like reactive API.

### Basic Setup

Define your document types and create a Store:

```typescript
// [#DOC_TEST_21](packages/documentation/tests/store.test.tsx)

import { Store } from '@supergrain/store'

interface DocumentTypes {
  users: {
    id: number
    firstName: string
    lastName: string
    email: string
  }
  posts: {
    id: number
    title: string
    content: string
    userId: number
  }
}

// Create store with optional fetch handler
const store = new Store<DocumentTypes>(async (modelType, id) => {
  const response = await fetch(`/api/${modelType}/${id}`)
  return response.json()
})

// Or without fetch handler (manual data management)
const store = new Store<DocumentTypes>()
```

### Finding Documents

```typescript
// [#DOC_TEST_22](packages/documentation/tests/store.test.tsx)

// Get a document (returns immediately, fetches if not cached)
const doc = store.findDoc('posts', 1)

// Document States - Documents have a promise-like API with these properties:
doc.content // T | undefined - The document data
doc.isPending // boolean - Request in progress
doc.isSettled // boolean - Request completed (success or failure)
doc.isRejected // boolean - Request failed
doc.isFulfilled // boolean - Request succeeded
```

### Manual Document Management

```typescript
// [#DOC_TEST_23](packages/documentation/tests/store.test.tsx)

// Set document directly
store.setDocument('users', 1, {
  id: 1,
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
})

const user = store.findDoc('users', 1)
console.log(user.isFulfilled) // true
console.log(user.content) // { id: 1, firstName: 'Jane', ... }

// Handle errors
store.setDocumentError('users', 999, 'User not found')
const errorUser = store.findDoc('users', 999)
console.log(errorUser.isRejected) // true
```

### Inserting Documents

```typescript
// [#DOC_TEST_24](packages/documentation/tests/store.test.tsx)

// Shows as pending immediately, then fulfilled when complete
const newUserPromise = store.insertDocument('users', {
  id: 123,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
})

// Document is immediately available to other components
const user = store.findDoc('users', 123)
console.log(user.isPending) // true initially

const newUser = await newUserPromise
console.log(user.isFulfilled) // true after promise resolves
```

### React Integration

```typescript
// [#DOC_TEST_25](packages/documentation/tests/store.test.tsx)

function MyComponent() {
  // Documents are fetched automatically and cached
  const post = store.findDoc('posts', 1)
  const user = store.findDoc('users', post.content?.userId)

  if (post.isPending) return <div>Loading post...</div>
  if (post.isRejected) return <div>Error loading post</div>

  return (
    <article>
      <h1>{post.content?.title}</h1>
      {user.content && (
        <p>By: {user.content.firstName} {user.content.lastName}</p>
      )}
    </article>
  )
}
```

## Building a TODO App

_Links: [Source Code](packages/react/examples/todo-app.tsx)._

Here's a complete TODO application demonstrating Supergrain's features:

```typescript
// [#DOC_TEST_26](packages/documentation/tests/todo-app.test.tsx)

import { createStore } from '@supergrain/core'
import { useTrackedStore, For } from '@supergrain/react'
import { memo } from 'react'

interface Todo {
  id: number
  text: string
  completed: boolean
}

// Create store
const [store, update] = createStore({
  todos: [] as Todo[],
  filter: 'all' as 'all' | 'active' | 'completed',
  newTodoText: '',
})

// Memoized todo item component
const TodoItem = memo(({ todo }: { todo: Todo }) => {
  const toggleTodo = () => {
    const index = store.todos.findIndex(t => t.id === todo.id)
    update({
      $set: { [`todos.${index}.completed`]: !todo.completed }
    })
  }

  const deleteTodo = () => {
    update({ $pull: { todos: { id: todo.id } } })
  }

  return (
    <div className={todo.completed ? 'completed' : 'pending'}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={toggleTodo}
      />
      <span>{todo.text}</span>
      <button onClick={deleteTodo}>Delete</button>
    </div>
  )
})

function TodoApp() {
  const state = useTrackedStore(store)

  const addTodo = () => {
    if (state.newTodoText.trim()) {
      update({
        $push: {
          todos: {
            id: Date.now(),
            text: state.newTodoText,
            completed: false
          }
        },
        $set: { newTodoText: '' }
      })
    }
  }

  const filteredTodos = state.todos.filter(todo => {
    if (state.filter === 'active') return !todo.completed
    if (state.filter === 'completed') return todo.completed
    return true
  })

  return (
    <div>
      <h1>TODO App</h1>

      <div>
        <input
          value={state.newTodoText}
          onChange={e => update({ $set: { newTodoText: e.target.value } })}
          onKeyPress={e => e.key === 'Enter' && addTodo()}
          placeholder="What needs to be done?"
        />
        <button onClick={addTodo}>Add</button>
      </div>

      <div>
        {['all', 'active', 'completed'].map(filter => (
          <button
            key={filter}
            className={state.filter === filter ? 'active' : ''}
            onClick={() => update({ $set: { filter } })}
          >
            {filter}
          </button>
        ))}
      </div>

      <For each={filteredTodos} fallback={<p>No todos to show</p>}>
        {todo => <TodoItem key={todo.id} todo={todo} />}
      </For>

      <div>
        Total: {state.todos.length} |
        Active: {state.todos.filter(t => !t.completed).length} |
        Completed: {state.todos.filter(t => t.completed).length}
      </div>
    </div>
  )
}
```

## TypeScript

Supergrain provides full TypeScript support with type inference and type safety:

```typescript
// [#DOC_TEST_27](packages/documentation/tests/typescript.test.ts)

interface AppState {
  user: {
    name: string
    age: number
    preferences: {
      theme: 'light' | 'dark'
      notifications: boolean
    }
  }
  items: Array<{ id: string; title: string; count: number }>
}

const [store, update] = createStore<AppState>({
  user: {
    name: 'John',
    age: 30,
    preferences: {
      theme: 'light',
      notifications: true
    }
  },
  items: []
})

// TypeScript will enforce correct types in updates
update({
  $set: {
    'user.name': 'Jane',        // ✅ string
    'user.age': 'invalid'       // ❌ TypeScript error - must be number
  },
  $push: {
    items: {
      id: '1',
      title: 'Item 1',
      count: 5                  // ✅ All required fields
    }
  }
})

// Component usage is also type-safe
function UserProfile() {
  const state = useTrackedStore(store)

  return (
    <div>
      <h1>{state.user.name}</h1>        {/* ✅ TypeScript knows this is string */}
      <p>Age: {state.user.age}</p>       {/* ✅ TypeScript knows this is number */}
    </div>
  )
}
```

## Performance Tips

1. **Use React.memo for list items** - When rendering arrays, wrap item components with `React.memo` or use the `For` component for automatic optimization

2. **Access only needed properties** - The more specific your property access, the fewer re-renders you'll get

3. **Batch updates when possible** - Multiple operations in one `update()` call are automatically batched

4. **Use computed values for derived state** - Instead of recalculating in components, use `computed()` for efficient caching

5. **Avoid accessing array length in hot paths** - `state.items.length` creates a subscription to the entire array; consider tracking count separately if needed

6. **Profile with React DevTools** - Use the React DevTools Profiler to identify unnecessary re-renders

The reactive system is designed to be fast by default, but following these patterns will help you achieve optimal performance in complex applications.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development

```bash
# Clone the repository
git clone https://github.com/commoncurriculum/supergrain.git
cd supergrain

# Install dependencies
pnpm install

# Build packages
pnpm -r --filter="@supergrain/*" build

# Run tests
pnpm test

# Run type checks
pnpm run typecheck
```

### Publishing Releases

This project uses [Changesets](https://github.com/changesets/changesets) for automated releases. You can create changesets via:
- **GitHub UI**: Use the [Add Changeset workflow](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml) (no terminal needed!)
- **Terminal**: Run `pnpm changeset`

GitHub Actions automatically handles versioning, changelogs, and publishing to NPM.

**Documentation:**
- [NPM_SETUP.md](NPM_SETUP.md) - Complete guide for setting up NPM publishing (tokens, scoped packages, troubleshooting)
- [RELEASING.md](RELEASING.md) - Step-by-step instructions for creating releases

## License

MIT
