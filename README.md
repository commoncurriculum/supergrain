# Storable

A reactive store library with fine-grained reactivity powered by alien-signals. Create stores that track property access and update components with surgical precision using MongoDB-style update operators.

_Core Implementation: [packages/core/src](packages/core/src) | React Integration: [packages/react/src](packages/react/src) | Examples: [packages/react/examples](packages/react/examples)_

## Features

- 🎯 **Fine-grained reactivity** - Only components using changed data re-render
- 🔄 **MongoDB-style operators** - Powerful update operations with automatic batching
- 📦 **Zero boilerplate** - No actions, reducers, or decorators required
- ⚛️ **React integration** - Simple hooks for reactive components
- 📝 **Full TypeScript support** - Complete type safety and inference

## Installation

_Package definitions: [core/package.json](packages/core/package.json) | [react/package.json](packages/react/package.json)_

```bash
npm install @storable/core @storable/react
# or
pnpm add @storable/core @storable/react
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

## Documentation

📖 **[Complete Documentation & Examples → USAGE.md](USAGE.md)**

The USAGE.md file contains:

- Comprehensive tutorials and examples
- Complete API reference
- Building a full TODO app
- Performance optimization tips
- Advanced patterns and best practices
- TypeScript usage

## License

MIT
