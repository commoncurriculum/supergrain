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

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Key Concepts](#key-concepts)
- [Core Concepts](#core-concepts)
- [Creating Stores](#creating-stores)
- [Reading State](#reading-state)
- [Updating State](#updating-state)
- [React Integration](#react-integration)
- [How the Reactive System Works](#how-the-reactive-system-works)
- [MongoDB-Style Operators](#mongodb-style-operators)
- [Effects and Computed Values](#effects-and-computed-values)
- [App Store - Document Management](#app-store---document-management)
- [Building a TODO App](#building-a-todo-app)
- [TypeScript](#typescript)
- [Performance Tips](#performance-tips)

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

_Implementation: [createStore](packages/core/src/store.ts) | [useTrackedStore](packages/react/src/use-store.ts) | Tests: [todo.test.ts](packages/core/tests/todo.test.ts) | [Documentation Tests](packages/documentation/tests)_

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

**Test Coverage**: [Quick Start Tests](packages/documentation/tests/quick-start.test.tsx)

## How It Works

### Reactive System Architecture

Storable uses **fine-grained reactivity** powered by `alien-signals` to automatically track which components access which data, creating subscriptions only to properties that are actually used.

#### **The Magic of `useTrackedStore`**

When you call `useTrackedStore(store)` in a React component, it:

1. **Creates an effect context** using `alien-signals`
2. **Returns a proxy** of your store that tracks property access
3. **Automatically subscribes** to any properties accessed during render
4. **Re-renders the component** only when subscribed properties change

```typescript
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

**Test Coverage**: [Reactive System Tests](packages/documentation/tests/reactive-system.test.tsx)

#### **Property Access = Subscription**

Every property you access during render creates a subscription. The system is so precise that:

- ✅ `state.items[0].name` creates subscription to that exact property
- ✅ `state.items.map(item => item.title)` creates subscriptions to each item's title
- ✅ Deeply nested access like `state.a.b.c.d.e` works perfectly
- ❌ Accessing `state.items[0].name` won't re-render when `state.items[0].age` changes

#### **No Manual Subscription Management**

Unlike other reactive systems, you never need to manually subscribe or unsubscribe:

```typescript
// ❌ Other libraries require manual subscriptions
const unsubscribe = store.subscribe('user.name', callback)
useEffect(() => unsubscribe, [])

// ✅ Storable: just access the data normally
const userName = useTrackedStore(store).user.name // Automatically subscribed!
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

**Test Coverage**: [Read-Only State Tests](packages/documentation/tests/read-only-state.test.ts)

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

**Test Coverage**: [Fine-Grained Reactivity Tests](packages/documentation/tests/fine-grained-reactivity.test.tsx)

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

**Test Coverage**: [Memoized Components Tests](packages/documentation/tests/memoized-components.test.tsx)

**Benefits of this pattern:**

- Only components accessing changed data re-render
- React.memo works effectively with fine-grained subscriptions
- Deep nested updates don't cause cascade re-renders
- Maintains optimal performance even with complex component trees

### Important: Subscription Behavior

The reactive system creates subscriptions based on **exactly which properties you access** during render:

#### **Precise Property Subscriptions**

```typescript
// Component only subscribes to the specific properties it accesses
const ProfileComponent = () => {
  const state = useTrackedStore(store)
  return <div>{state.user.profile.name}</div> // Only subscribes to 'user.profile.name'
}

// This update WILL trigger re-render (accesses user.profile.name)
update({ $set: { 'user.profile.name': 'Jane' } })

// This update will NOT trigger re-render (doesn't access user.profile.age)
update({ $set: { 'user.profile.age': 30 } })
```

#### **Array Iteration Creates Item Subscriptions**

When you iterate over arrays, you create subscriptions to the properties you access on each item:

```typescript
const ListComponent = () => {
  const state = useTrackedStore(store)
  return (
    <div>
      {state.items.map(item => (
        <div key={item.id}>{item.name}</div> // Subscribes to each item.name
      ))}
    </div>
  )
}

// This WILL trigger re-render because the component accesses items[0].name during iteration
update({ $set: { 'items.0.name': 'Updated' } })

// This will NOT trigger re-render because the component doesn't access items[0].description
update({ $set: { 'items.0.description': 'New desc' } })
```

#### **Deep Nesting Works Perfectly**

```typescript
const DeepComponent = () => {
  const state = useTrackedStore(store)
  // Creates subscription to this exact nested property
  return <div>{state.items[0].obj.objTwo.objThree}</div>
}

// This WILL trigger re-render - exact property match
update({ $set: { 'items.0.obj.objTwo.objThree': 42 } })

// This will NOT trigger re-render - different property
update({ $set: { 'items.0.obj.objTwo.otherProp': 'value' } })
```

**Test Coverage**: [Subscription Behavior Tests](packages/documentation/tests/subscription-behavior.test.tsx)

**Key insight**: Components re-render when **properties they actually access** change, regardless of nesting depth or data structure. The system is truly fine-grained.

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

**Test Coverage**: [For Component Tests](packages/documentation/tests/for-component.test.tsx)

**Benefits:**

- Automatically passes version information to enable React.memo optimization
- Uses stable keys (item.id if available, otherwise index)
- Only re-renders items whose data actually changed
- Supports fallback content for empty arrays

## Core Concepts

### What is Storable?

Storable is a reactive state management library that:

- Creates reactive stores with JavaScript Proxy objects
- Tracks property access for fine-grained reactivity
- Updates state ONLY through MongoDB-style operators
- Integrates seamlessly with React

### Key Principles

1. **Read-only state**: The state proxy is read-only; direct mutations throw errors
2. **Operator-based updates**: All changes use MongoDB-style operators via the `update` function
3. **Fine-grained reactivity**: Components only re-render when accessed properties change
4. **Automatic batching**: Multiple updates in one call are batched

## Creating Stores

_Implementation: [store.ts](packages/core/src/store.ts) | Tests: [store.test.ts](packages/core/tests/store.test.ts)_

```typescript
import { createStore } from '@storable/core'

// Simple store
const [state, update] = createStore({
  count: 0,
  name: 'John',
})

// With nested objects
const [state, update] = createStore({
  user: {
    name: 'Alice',
    address: {
      city: 'New York',
      zip: '10001',
    },
  },
  todos: [],
})
```

**Test Coverage**: [Creating Stores Tests](packages/documentation/tests/creating-stores.test.ts)

## Reading State

_Implementation: [store.ts](packages/core/src/store.ts) | Tests: [store.test.ts](packages/core/tests/store.test.ts)_

The state object is a reactive proxy that tracks property access:

```typescript
const [state, update] = createStore({ count: 0, name: 'John' })

// You can read properties normally
console.log(state.count) // 0
console.log(state.name) // 'John'

// But you CANNOT mutate them directly
state.count = 5 // ❌ Throws: "Direct mutation of store state is not allowed"
state.name = 'Jane' // ❌ Throws: "Direct mutation of store state is not allowed"
delete state.name // ❌ Throws: "Direct deletion of store state is not allowed"
```

**Test Coverage**: [Reading State Tests](packages/documentation/tests/reading-state.test.ts)

## Updating State

_Implementation: [operators.ts](packages/core/src/operators.ts) | Tests: [operators.test.ts](packages/core/tests/operators.test.ts)_

All state updates MUST use the `update` function with MongoDB-style operators:

```typescript
const [state, update] = createStore({
  count: 0,
  user: { name: 'John', age: 30 },
  items: ['a', 'b', 'c'],
})

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

**Test Coverage**: [Updating State Tests](packages/documentation/tests/updating-state.test.ts)

## React Integration

_Implementation: [use-store.ts](packages/react/src/use-store.ts) | Tests: [use-store.test.tsx](packages/react/tests/use-store.test.tsx) | Example: [nested-components.tsx](packages/react/examples/nested-components.tsx)_

### useTrackedStore Hook

The primary way to use stores in React:

```typescript
import { useTrackedStore } from '@storable/react'

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

### useStore Hook

Alternative hook that must be called first in the component:

```typescript
import { useStore } from '@storable/react'

function Counter() {
  useStore() // Must be called first!

  return (
    <div>
      <p>Count: {store.count}</p>
      <button onClick={() => update({ $inc: { count: 1 } })}>
        Increment
      </button>
    </div>
  )
}
```

**Test Coverage**: [React Integration Tests](packages/documentation/tests/react-integration.test.tsx)

### Fine-grained Reactivity

Components only re-render when properties they access change:

```typescript
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

### For Component - Optimized Array Rendering

The `For` component provides optimal performance when rendering arrays by automatically handling version props for React.memo optimization:

```typescript
import { For } from '@storable/react'
import { memo } from 'react'

// Create a memoized item component
const TodoItem = memo(({ todo, onToggle, onDelete }) => (
  <div className={todo.completed ? 'completed' : 'pending'}>
    <input
      type="checkbox"
      checked={todo.completed}
      onChange={() => onToggle(todo.id)}
    />
    <span>{todo.text}</span>
    <button onClick={() => onDelete(todo.id)}>Delete</button>
  </div>
))

function TodoList() {
  const state = useTrackedStore(store)

  const toggleTodo = (id) => {
    update({
      $set: {
        [`todos.${state.todos.findIndex(t => t.id === id)}.completed`]:
          !state.todos.find(t => t.id === id).completed
      }
    })
  }

  const deleteTodo = (id) => {
    update({ $pull: { todos: { id } } })
  }

  return (
    <div>
      <h3>Todo List ({state.todos.length})</h3>
      <For each={state.todos} fallback={<p>No todos yet. Add one above!</p>}>
        {(todo, index) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggle={toggleTodo}
            onDelete={deleteTodo}
          />
        )}
      </For>
    </div>
  )
}
```

**Key Features:**

- **Automatic optimization**: Passes version information to enable React.memo
- **Stable keys**: Uses `item.id` when available, falls back to array index
- **Selective re-renders**: Only items whose data changed will re-render
- **Fallback support**: Shows fallback content when array is empty
- **Type safety**: Full TypeScript support with generic typing

**Performance Benefits:**

- With `For` + `memo`: Only changed items re-render (optimal)
- Without `For`: All items may re-render when any item changes
- 10-100x performance improvement for large lists

## How the Reactive System Works

### Property Access Tracking

Storable's fine-grained reactivity is powered by JavaScript Proxy objects and the alien-signals library. Here's how it works:

1. **Proxy Wrapping**: The state object returned by `createStore` is a Proxy that intercepts all property access
2. **Subscription Creation**: When `useTrackedStore` is called, it creates an effect context
3. **Property Tracking**: During component render, any property access on the state object creates a subscription
4. **Precise Updates**: Only components that accessed changed properties will re-render

### Understanding useTrackedStore

The `useTrackedStore` hook is what enables reactive subscriptions:

```typescript
// ❌ Without useTrackedStore - component never re-renders
function BrokenComponent() {
  return <div>Count: {store.count}</div> // No subscription created!
}

// ✅ With useTrackedStore - component re-renders when count changes
function WorkingComponent() {
  const state = useTrackedStore(store)
  return <div>Count: {state.count}</div> // Subscription created for 'count'
}
```

### Subscription Specificity

Subscriptions are created only for properties that are actually accessed:

```typescript
const [state, update] = createStore({
  user: { name: 'John', age: 30, email: 'john@example.com' },
  todos: [],
  settings: { theme: 'dark' }
})

function UserName() {
  const state = useTrackedStore(store)
  // Only subscribes to 'user.name' - won't re-render for age, email, todos, or settings
  return <div>{state.user.name}</div>
}

function UserAge() {
  const state = useTrackedStore(store)
  // Only subscribes to 'user.age' - completely independent from UserName component
  return <div>{state.user.age}</div>
}

// This update only re-renders UserAge, not UserName
update({ $set: { 'user.age': 31 } })
```

### Deep Nesting and Arrays

The reactive system works seamlessly with deeply nested data structures:

```typescript
const [state, update] = createStore({
  departments: [{
    teams: [{
      members: [{
        projects: [{
          tasks: [{ name: 'Task 1', completed: false }]
        }]
      }]
    }]
  }]
})

function DeepTaskComponent() {
  const state = useTrackedStore(store)

  // Creates subscription specifically for this deep path:
  // departments[0].teams[0].members[0].projects[0].tasks[0].completed
  const task = state.departments[0].teams[0].members[0].projects[0].tasks[0]

  return (
    <div className={task.completed ? 'done' : 'pending'}>
      {task.name}
    </div>
  )
}

// This update will only re-render components that access this specific task
update({
  $set: { 'departments.0.teams.0.members.0.projects.0.tasks.0.completed': true }
})
```

### Array Iteration Behavior

When components iterate over arrays, they subscribe to the items they access:

```typescript
const [state, update] = createStore({
  items: [
    { id: 1, name: 'Item 1', value: 10 },
    { id: 2, name: 'Item 2', value: 20 },
    { id: 3, name: 'Item 3', value: 30 }
  ]
})

function ItemList() {
  const state = useTrackedStore(store)

  return (
    <ul>
      {state.items.map((item, index) => (
        <li key={item.id}>
          {/* Creates subscriptions for items[0].name, items[1].name, items[2].name */}
          {item.name}: {item.value}
        </li>
      ))}
    </ul>
  )
}

// When one item changes, the entire list re-renders because the parent
// component iterates over the array and accesses each item
update({ $set: { 'items.0.value': 15 } }) // Re-renders ItemList
```

### Optimizing Array Rendering

For optimal performance with arrays, use React.memo on item components:

```typescript
const MemoizedItem = React.memo(({ item }: { item: any }) => {
  // Each item component has its own useTrackedStore call
  const state = useTrackedStore(store)

  // Find this specific item in the store
  const currentItem = state.items.find(i => i.id === item.id)

  return (
    <div>
      {currentItem?.name}: {currentItem?.value}
    </div>
  )
})

function OptimizedItemList() {
  const state = useTrackedStore(store)

  return (
    <ul>
      {state.items.map(item => (
        <MemoizedItem key={item.id} item={item} />
      ))}
    </ul>
  )
}
```

Or use the `For` component which handles this optimization automatically:

```typescript
import { For } from '@storable/react'

const ItemComponent = React.memo(({ item }: { item: any }) => {
  return <div>{item.name}: {item.value}</div>
})

function OptimalItemList() {
  const state = useTrackedStore(store)

  return (
    <For each={state.items}>
      {(item) => <ItemComponent item={item} />}
    </For>
  )
}
```

**Test Coverage**: [Reactive System Deep Dive Tests](packages/documentation/tests/reactive-system-deep-dive.test.tsx)

### Effect Context and Signals

Under the hood, Storable uses the alien-signals library for reactivity:

```typescript
import { effect, computed } from '@storable/core'

const [state, update] = createStore({ count: 0, multiplier: 2 })

// Effects track property access and run when dependencies change
effect(() => {
  console.log('Count is:', state.count) // Subscribes to 'count'
})

// Computed values work the same way
const doubled = computed(() => state.count * state.multiplier) // Subscribes to both properties

// React components work identically - useTrackedStore creates an effect context
```

### Key Principles

1. **Property Access = Subscription**: Any property you read during render creates a subscription
2. **Precise Tracking**: Only components that access changed properties re-render
3. **Deep Reactivity**: Works with arbitrarily nested object and array structures
4. **Effect Context**: `useTrackedStore`, `effect`, and `computed` all use the same underlying mechanism
5. **No Magic**: The system is deterministic - subscriptions are created based on actual property access

## MongoDB-Style Operators

_Implementation: [operators.ts](packages/core/src/operators.ts) | Tests: [operators.test.ts](packages/core/tests/operators.test.ts)_

### $set - Set field values

```typescript
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
update({ $unset: { temporaryField: 1 } })
update({ $unset: { 'user.middleName': 1 } })
```

### $inc - Increment numeric values

```typescript
update({ $inc: { count: 1 } })
update({ $inc: { count: -5 } }) // Decrement
update({ $inc: { 'stats.views': 10 } })
```

### $push - Add to arrays

```typescript
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
update({ $rename: { oldFieldName: 'newFieldName' } })
update({ $rename: { 'user.firstName': 'user.name' } })
```

### $min/$max - Conditional updates

```typescript
// Only updates if new value is smaller
update({ $min: { lowestScore: 50 } })

// Only updates if new value is larger
update({ $max: { highestScore: 100 } })
```

**Test Coverage**: [MongoDB Operators Tests](packages/documentation/tests/mongodb-operators.test.ts)

## Effects and Computed Values

_Implementation: Re-exported from alien-signals in [index.ts](packages/core/src/index.ts) | Usage Examples: [benchmarks](packages/core/benchmarks/additional.bench.ts)_

### Effects

React to state changes with `effect`:

```typescript
import { effect } from '@storable/core'

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
import { computed } from '@storable/core'

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

**Test Coverage**: [Effects and Computed Tests](packages/documentation/tests/effects-computed.test.ts)

## App Store - Document Management

_Implementation: [app-store.ts](packages/app-store/src/app-store.ts) | Tests: [app-store.test.ts](packages/app-store/tests/app-store.test.ts)_

The `@storable/app-store` package provides a document-oriented store built on top of the core Storable reactivity system. It's designed for managing app-level data with a promise-like reactive API.

### Key Features

- **Document-oriented**: Store and retrieve documents by type and ID
- **Promise-like API**: Familiar async patterns with reactive updates
- **Automatic fetching**: Configurable fetch handlers for external data
- **Type-safe**: Full TypeScript support with model registry
- **Caching**: Documents cached automatically to prevent duplicate requests
- **Optimistic updates**: Immediate UI updates for better UX

### Basic Setup

First, define your document types:

```typescript
import { AppStore } from '@storable/app-store'

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

// Global type registry
interface DocumentTypes {
  users: User
  posts: Post
}
```

Create an app store with optional fetch handler:

```typescript
// With automatic fetching
const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
  const response = await fetch(`/api/${modelType}/${id}`)
  if (!response.ok) throw new Error('Failed to fetch')
  return response.json()
})

// Without fetch handler (manual data management)
const appStore = new AppStore<DocumentTypes>()
```

### Finding Documents

Use `findDoc` to reactively retrieve documents:

```typescript
function BlogPost({ postId }: { postId: number }) {
  const post = appStore.findDoc("posts", postId)
  const author = appStore.findDoc("users", post.content?.userId)

  // Handle loading state
  if (post.isPending) return <div>Loading post...</div>

  // Handle error state
  if (post.isRejected) return <div>Error loading post</div>

  // Handle success state
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

### Document States

Documents have a promise-like API with these properties:

```typescript
const doc = appStore.findDoc('posts', 1)

doc.content // T | undefined - The document data
doc.isPending // boolean - Request in progress
doc.isSettled // boolean - Request completed (success or failure)
doc.isRejected // boolean - Request failed
doc.isFulfilled // boolean - Request succeeded
```

### Inserting Documents

Create new documents with optimistic updates:

```typescript
async function createUser() {
  // Shows as pending immediately, then fulfilled when complete
  const newUser = await appStore.insertDocument('users', {
    id: 123,
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
  })

  // Document is immediately available to other components
  const user = appStore.findDoc('users', 123)
  console.log(user.content) // Available immediately
}
```

### Manual Document Management

Set document content or errors manually:

```typescript
// Set document directly
appStore.setDocument('users', 1, {
  id: 1,
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
})

// Handle errors
appStore.setDocumentError('users', 999, 'User not found')
```

### Reactive Patterns

Documents integrate seamlessly with computed values:

```typescript
import { computed } from '@storable/core'

function UserProfile({ userId }: { userId: number }) {
  const user = appStore.findDoc('users', userId)

  // Reactive computed value
  const displayName = computed(() =>
    user.content
      ? `${user.content.firstName} ${user.content.lastName}`
      : 'Unknown User'
  )

  return (
    <div>
      <h2>{displayName()}</h2>
      <p>{user.content?.email}</p>
    </div>
  )
}
```

### Advanced Fetch Handlers

Handle authentication, caching, and error scenarios:

```typescript
const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
  const token = localStorage.getItem('authToken')

  const response = await fetch(`/api/${modelType}/${id}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=300', // 5 minute cache
    },
  })

  if (response.status === 401) {
    // Handle authentication
    window.location.href = '/login'
    throw new Error('Authentication required')
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json()
})
```

### Multiple Document Types

The app store handles multiple document types seamlessly:

```typescript
function BlogPostWithRelations({ postId }: { postId: number }) {
  const post = appStore.findDoc('posts', postId)
  const author = appStore.findDoc('users', post.content?.userId)
  const comments = appStore.findDoc('comments', `post:${postId}`)

  // All documents fetched automatically as dependencies resolve
  return (
    <article>
      <header>
        <h1>{post.content?.title}</h1>
        <p>By {author.content?.firstName}</p>
      </header>
      <div>{post.content?.content}</div>
      <footer>
        {comments.content?.map(comment => (
          <CommentComponent key={comment.id} comment={comment} />
        ))}
      </footer>
    </article>
  )
}
```

### Error Handling Best Practices

```typescript
function PostWithRetry({ postId }: { postId: number }) {
  const post = appStore.findDoc('posts', postId)

  if (post.isPending) {
    return <div className="loading">Loading post...</div>
  }

  if (post.isRejected) {
    return (
      <div className="error">
        <h3>Failed to load post</h3>
        <button onClick={() => {
          // Clear the error and retry
          appStore.setDocument('posts', postId, undefined)
          // This will trigger a new fetch
          appStore.findDoc('posts', postId)
        }}>
          Retry
        </button>
      </div>
    )
  }

  return <PostContent post={post.content!} />
}
```

**Test Coverage**: [App Store Tests](packages/documentation/tests/app-store.test.tsx)

## Building a TODO App

_Core Tests: [todo.test.ts](packages/core/tests/todo.test.ts) | React Tests: [use-store-todo.test.tsx](packages/react/tests/use-store-todo.test.tsx)_

Here's a complete TODO app example using the actual API:

```typescript
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'
import { useState } from 'react'

// Types
interface Todo {
  id: number
  text: string
  completed: boolean
}

interface AppState {
  todos: Todo[]
  filter: 'all' | 'active' | 'completed'
}

// Create store
const [todoStore, updateTodos] = createStore<AppState>({
  todos: [],
  filter: 'all'
})

// Main component
function TodoApp() {
  const state = useTrackedStore(todoStore)
  const [inputText, setInputText] = useState('')

  const addTodo = () => {
    if (!inputText.trim()) return

    updateTodos({
      $push: {
        todos: {
          id: Date.now(),
          text: inputText,
          completed: false
        }
      }
    })

    setInputText('')
  }

  const toggleTodo = (id: number) => {
    const index = state.todos.findIndex(t => t.id === id)
    if (index !== -1) {
      updateTodos({
        $set: {
          [`todos.${index}.completed`]: !state.todos[index].completed
        }
      })
    }
  }

  const deleteTodo = (id: number) => {
    updateTodos({
      $pull: { todos: { id } }
    })
  }

  const clearCompleted = () => {
    const activeTodos = state.todos.filter(t => !t.completed)
    updateTodos({
      $set: { todos: activeTodos }
    })
  }

  // Filter todos
  const filteredTodos = state.todos.filter(todo => {
    if (state.filter === 'active') return !todo.completed
    if (state.filter === 'completed') return todo.completed
    return true
  })

  return (
    <div>
      <h1>TODO App</h1>

      {/* Add todo */}
      <div>
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && addTodo()}
          placeholder="What needs to be done?"
        />
        <button onClick={addTodo}>Add</button>
      </div>

      {/* Filters */}
      <div>
        {(['all', 'active', 'completed'] as const).map(filterType => (
          <button
            key={filterType}
            className={state.filter === filterType ? 'active' : ''}
            onClick={() => updateTodos({ $set: { filter: filterType } })}
          >
            {filterType}
          </button>
        ))}
      </div>

      {/* Todo list */}
      <ul>
        {filteredTodos.map(todo => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
            />
            <span style={{
              textDecoration: todo.completed ? 'line-through' : 'none'
            }}>
              {todo.text}
            </span>
            <button onClick={() => deleteTodo(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>

      {/* Clear completed */}
      {state.todos.some(t => t.completed) && (
        <button onClick={clearCompleted}>
          Clear Completed
        </button>
      )}
    </div>
  )
}
```

**Test Coverage**: [TODO App Tests](packages/documentation/tests/todo-app.test.tsx)

## TypeScript

_Type Definitions: [store.ts](packages/core/src/store.ts) | [operators.ts](packages/core/src/operators.ts) | Exports: [index.ts](packages/core/src/index.ts)_

Storable has full TypeScript support:

```typescript
interface User {
  name: string
  age: number
  email?: string
}

interface AppState {
  user: User
  todos: Array<{ id: number; text: string }>
}

const [state, update] = createStore<AppState>({
  user: { name: 'John', age: 30 },
  todos: [],
})

// Type-safe updates
update({ $set: { 'user.name': 'Jane' } }) // ✅ OK
update({ $set: { 'user.invalid': 'value' } }) // ❌ Type error

// Type-safe array operations
update({
  $push: {
    todos: { id: 1, text: 'Task' }, // ✅ OK
  },
})

update({
  $push: {
    todos: { text: 'Task' }, // ❌ Type error: missing 'id'
  },
})
```

**Test Coverage**: [TypeScript Tests](packages/documentation/tests/typescript.test.tsx)

## Performance Tips

_Examples: [nested-components.tsx](packages/react/examples/nested-components.tsx) | Tests: [use-store.test.tsx](packages/react/tests/use-store.test.tsx)_

### 1. Split Components by Data Access

Components only re-render for data they access:

```typescript
// Parent only re-renders when todos array changes
function TodoList() {
  const state = useTrackedStore(store)
  return (
    <ul>
      {state.todos.map(todo => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  )
}

// Child only re-renders when its specific todo changes
function TodoItem({ todo }) {
  return <li>{todo.text}</li>
}
```

### 2. Avoid Unnecessary Property Access

```typescript
// ❌ Bad: Accesses all properties
const { x, y, z } = state // Component re-renders on any change

// ✅ Good: Access only what you need
const x = state.x // Component only re-renders when x changes
```

### 3. Batch Updates

_Implementation: [store.ts](packages/core/src/store.ts) | Tests: [store.test.ts](packages/core/tests/store.test.ts)_

Multiple operations in one update call are automatically batched:

```typescript
// ✅ Good: Single re-render
update({
  $set: { 'user.name': 'Jane' },
  $inc: { count: 1 },
  $push: { items: 'new' },
})

// ❌ Less efficient: Multiple re-renders
update({ $set: { 'user.name': 'Jane' } })
update({ $inc: { count: 1 } })
update({ $push: { items: 'new' } })
```

**Test Coverage**: [Performance Tips Tests](packages/documentation/tests/performance-tips.test.tsx)

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

## Key Takeaways

1. **State is read-only** - Never try to mutate the state directly
2. **Use update function** - All changes must go through MongoDB-style operators
3. **Fine-grained reactivity** - Components only re-render for accessed properties
4. **Automatic batching** - Multiple operations in one update are batched
5. **TypeScript friendly** - Full type safety and inference

## License

MIT
