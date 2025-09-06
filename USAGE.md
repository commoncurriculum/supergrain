# Storable Usage Guide

A comprehensive guide to using Storable for building reactive applications with fine-grained reactivity.

## Table of Contents

- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Creating Stores](#creating-stores)
- [Reading State](#reading-state)
- [Updating State](#updating-state)
- [React Integration](#react-integration)
- [MongoDB-Style Operators](#mongodb-style-operators)
- [Effects and Computed Values](#effects-and-computed-values)
- [Building a TODO App](#building-a-todo-app)
- [TypeScript](#typescript)
- [Performance Tips](#performance-tips)

## Installation

```bash
npm install @storable/core @storable/react
# or
pnpm add @storable/core @storable/react
```

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

## Reading State

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

## Updating State

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

## React Integration

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

## MongoDB-Style Operators

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

## Effects and Computed Values

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

## Building a TODO App

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

## TypeScript

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

## Performance Tips

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

## Key Takeaways

1. **State is read-only** - Never try to mutate the state directly
2. **Use update function** - All changes must go through MongoDB-style operators
3. **Fine-grained reactivity** - Components only re-render for accessed properties
4. **Automatic batching** - Multiple operations in one update are batched
5. **TypeScript friendly** - Full type safety and inference
