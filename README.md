# Storable

A reactive store library with fine-grained reactivity powered by alien-signals. Create stores that track property access and update components with surgical precision using MongoDB-style update operators.

## Features

- 🎯 **Fine-grained reactivity** - Only components using changed data re-render
- 🔄 **MongoDB-style operators** - Powerful update operations with automatic batching
- 📦 **Zero boilerplate** - No actions, reducers, or decorators required
- ⚛️ **React integration** - Simple hooks for reactive components
- 📝 **Full TypeScript support** - Complete type safety and inference

## Installation

```bash
npm install @storable/core @storable/react
# or
pnpm add @storable/core @storable/react
```

## Quick Start

```typescript
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'

// Create a store with initial state
const [store, update] = createStore({
  count: 0,
  todos: [],
  filter: 'all'
})

// Use in React components
function TodoApp() {
  const state = useTrackedStore(store)

  // Updates MUST use the update function with operators
  const addTodo = (text: string) => {
    update({
      $push: {
        todos: {
          id: Date.now(),
          text,
          completed: false
        }
      }
    })
  }

  // Toggle a todo's completed status
  const toggleTodo = (id: number) => {
    const index = state.todos.findIndex(t => t.id === id)
    if (index !== -1) {
      update({
        $set: { [`todos.${index}.completed`]: !state.todos[index].completed }
      })
    }
  }

  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button onClick={() => update({ $inc: { count: 1 } })}>
        Increment
      </button>
      {state.todos.map(todo => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => toggleTodo(todo.id)}
          />
          {todo.text}
        </div>
      ))}
    </div>
  )
}
```

## Core Concepts

### Creating Stores

Stores hold your application state and make it reactive:

```typescript
import { createStore } from '@storable/core'

// Simple store
const [state, update] = createStore({
  count: 0,
  user: { name: 'John', age: 30 },
})

// The state object is READ-ONLY - you cannot mutate it directly
// state.count++ // ❌ This will throw an error!
// state.user.name = 'Jane' // ❌ This will throw an error!

// All updates MUST go through the update function
update({ $set: { count: 5 } }) // ✅ Correct way
update({ $set: { 'user.name': 'Jane' } }) // ✅ Correct way
```

### MongoDB-Style Update Operators

All state changes must use MongoDB-style operators through the `update` function:

```typescript
// Set values
update({
  $set: { 'user.name': 'Jane', 'settings.theme': 'light' },
})

// Increment numeric values
update({
  $inc: { count: 1, 'stats.views': 10 },
})

// Array operations
update({
  $push: { todos: newTodo },
  $pull: { tags: 'deprecated' },
  $addToSet: { uniqueItems: 'newItem' },
})

// Multiple operations in one update (batched automatically)
update({
  $set: { title: 'New Title' },
  $inc: { viewCount: 1 },
  $push: { history: { timestamp: Date.now(), action: 'view' } },
})
```

Available operators:

- `$set` - Set field values (supports dot notation)
- `$unset` - Remove fields
- `$inc` - Increment numeric values
- `$push` - Add to arrays (supports `$each` modifier)
- `$pull` - Remove from arrays by value or condition
- `$addToSet` - Add unique elements to arrays
- `$rename` - Rename fields
- `$min/$max` - Update if value is smaller/larger

## React Integration

### useTrackedStore Hook

The primary way to use stores in React components:

```typescript
import { useTrackedStore } from '@storable/react'

function TodoList() {
  const state = useTrackedStore(store)

  // Component only re-renders when accessed properties change
  return (
    <ul>
      {state.todos.map(todo => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  )
}

function TodoItem({ todo }) {
  // This component only re-renders when THIS specific todo changes
  return (
    <li>
      <span>{todo.text}</span>
      <button onClick={() => update({
        $set: { [`todos.${index}.completed`]: !todo.completed }
      })}>
        Toggle
      </button>
    </li>
  )
}
```

### useStore Hook

Alternative hook that must be called at the beginning of the component:

```typescript
import { useStore } from '@storable/react'

function Counter() {
  useStore() // Must be called first!

  return (
    <div>
      Count: {store.count}
      <button onClick={() => update({ $inc: { count: 1 } })}>
        Increment
      </button>
    </div>
  )
}
```

## Complete TODO App Example

Here's a working TODO app demonstrating the key features:

```typescript
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'
import { useState } from 'react'

// Define types
interface Todo {
  id: number
  text: string
  completed: boolean
  tags: string[]
}

interface TodoState {
  todos: Todo[]
  filter: 'all' | 'active' | 'completed'
}

// Create store
const [todoStore, updateTodos] = createStore<TodoState>({
  todos: [],
  filter: 'all'
})

// Main App Component
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
          completed: false,
          tags: []
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

  const addTag = (todoId: number, tag: string) => {
    const index = state.todos.findIndex(t => t.id === todoId)
    if (index !== -1) {
      updateTodos({
        $addToSet: { [`todos.${index}.tags`]: tag }
      })
    }
  }

  // Filter todos based on current filter
  const filteredTodos = state.todos.filter(todo => {
    if (state.filter === 'active') return !todo.completed
    if (state.filter === 'completed') return todo.completed
    return true
  })

  const stats = {
    total: state.todos.length,
    active: state.todos.filter(t => !t.completed).length,
    completed: state.todos.filter(t => t.completed).length
  }

  return (
    <div className="todo-app">
      <h1>TODOs</h1>

      {/* Add Todo */}
      <div>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && addTodo()}
          placeholder="What needs to be done?"
        />
        <button onClick={addTodo}>Add</button>
      </div>

      {/* Filters */}
      <div>
        <button
          className={state.filter === 'all' ? 'active' : ''}
          onClick={() => updateTodos({ $set: { filter: 'all' } })}
        >
          All ({stats.total})
        </button>
        <button
          className={state.filter === 'active' ? 'active' : ''}
          onClick={() => updateTodos({ $set: { filter: 'active' } })}
        >
          Active ({stats.active})
        </button>
        <button
          className={state.filter === 'completed' ? 'active' : ''}
          onClick={() => updateTodos({ $set: { filter: 'completed' } })}
        >
          Completed ({stats.completed})
        </button>
      </div>

      {/* Todo List */}
      <ul>
        {filteredTodos.map(todo => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggle={toggleTodo}
            onDelete={deleteTodo}
            onAddTag={addTag}
          />
        ))}
      </ul>

      {/* Actions */}
      {stats.completed > 0 && (
        <button onClick={clearCompleted}>
          Clear Completed ({stats.completed})
        </button>
      )}
    </div>
  )
}

// Todo Item Component
function TodoItem({ todo, onToggle, onDelete, onAddTag }) {
  const [tagInput, setTagInput] = useState('')

  return (
    <li className={todo.completed ? 'completed' : ''}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => onToggle(todo.id)}
      />
      <span>{todo.text}</span>

      {/* Tags */}
      <div className="tags">
        {todo.tags.map(tag => (
          <span key={tag} className="tag">#{tag}</span>
        ))}
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && tagInput) {
              onAddTag(todo.id, tagInput)
              setTagInput('')
            }
          }}
          placeholder="Add tag..."
        />
      </div>

      <button onClick={() => onDelete(todo.id)}>Delete</button>
    </li>
  )
}
```

## Advanced Patterns

### Effects

React to state changes outside of components:

```typescript
import { effect } from '@storable/core'

// Save todos to localStorage whenever they change
effect(() => {
  const todos = store.todos
  localStorage.setItem('todos', JSON.stringify(todos))
})

// Note: You can read from the store in effects, but you still
// cannot mutate it directly - use the update function
```

### Computed Values

Use `computed` from alien-signals for derived state:

```typescript
import { computed } from '@storable/core'

const activeTodosCount = computed(() =>
  store.todos.filter(t => !t.completed).length
)

// In component
function TodoStats() {
  useStore()
  return <div>Active: {activeTodosCount()}</div>
}
```

### Batching Updates

Multiple operations in a single update call are automatically batched:

```typescript
// These will cause only one re-render
update({
  $set: { filter: 'active', searchQuery: 'urgent' },
  $inc: { viewCount: 1 },
  $push: { recentFilters: 'active' },
})
```

### Working with Arrays

```typescript
// Add items
update({ $push: { items: newItem } })
update({ $push: { items: { $each: [item1, item2, item3] } } })

// Remove items
update({ $pull: { items: itemToRemove } })
update({ $pull: { items: { id: 123 } } }) // Remove by condition

// Add unique items
update({ $addToSet: { tags: 'newTag' } })
update({ $addToSet: { tags: { $each: ['tag1', 'tag2'] } } })

// Update specific array element
const index = state.items.findIndex(item => item.id === targetId)
update({ $set: { [`items.${index}.property`]: newValue } })
```

### Nested Updates

Use dot notation for nested properties:

```typescript
update({
  $set: {
    'user.profile.name': 'Jane',
    'user.profile.email': 'jane@example.com',
    'settings.theme.primary': '#007bff',
  },
  $inc: {
    'stats.profile.views': 1,
  },
})
```

## API Reference

### Core

- `createStore<T>(initialState: T): [state: T, update: UpdateFunction]` - Create a reactive store
- `unwrap(proxy: T): T` - Get the raw object from a proxy
- `signal`, `computed`, `effect` - Re-exported from alien-signals

### React

- `useTrackedStore(store: T): T` - Hook that returns a tracked proxy of the store
- `useStore(): void` - Hook that enables store tracking in a component (must be called first)

### Update Operators

- `$set: { path: value }` - Set field values
- `$unset: { path: true }` - Remove fields
- `$inc: { path: number }` - Increment numeric values
- `$push: { path: value | { $each: value[] } }` - Add to arrays
- `$pull: { path: condition }` - Remove from arrays
- `$addToSet: { path: value | { $each: value[] } }` - Add unique elements
- `$rename: { oldPath: newPath }` - Rename fields
- `$min/$max: { path: number }` - Conditional numeric updates

## Important Notes

1. **The store is read-only** - Direct mutations will throw an error
2. **All updates must use the update function** - This is the only way to modify state
3. **Updates are automatically batched** - Multiple operations in one update call result in a single re-render
4. **Fine-grained reactivity** - Components only re-render when properties they access change

## License

MIT
