---
layout: page
---

<div class="hero-section">
  <div class="hero-content">
    <h1 class="hero-title">Supergrain</h1>
    <p class="hero-tagline">Reactive stores that only update what changed. No selectors. No boilerplate. Just state that works.</p>
    <div class="hero-actions">
      <a href="https://github.com/commoncurriculum/supergrain" class="btn-primary">GitHub</a>
    </div>
  </div>
  <div class="hero-image">
    <img src="/mascot.jpg" alt="Supergrain mascot" class="mascot" />
  </div>
</div>

<div class="readme-content">

## Installation

```bash
# Core reactive store
npm install @supergrain/core @supergrain/react

# App-level document store (optional)
npm install @supergrain/store
```

## Quick Start

```typescript
import { createStore } from '@supergrain/core'
import { useTrackedStore } from '@supergrain/react'

// Create a store with initial state
const [store, update] = createStore({
  count: 0,
  user: { name: 'Jane' }
})

// Use in React components
function Counter() {
  const state = useTrackedStore(store)

  return (
    <div>
      <p>Count: {state.count}</p>
      <p>User: {state.user.name}</p>
      <button onClick={() => state.count++}>
        Increment
      </button>
    </div>
  )
}
```

That's it. When `state.count` changes, only components that read `state.count` re-render. Components reading `state.user.name` won't.

## How It Works

When you call `useTrackedStore(store)`, it returns a proxy that tracks which properties you access during render. Only those properties trigger re-renders when changed.

```typescript
function Profile() {
  const state = useTrackedStore(store)
  
  // This creates a subscription ONLY to 'user.profile.name'
  return <h1>{state.user.profile.name}</h1>
}

// Later:
state.user.profile.name = 'Bob'  // Profile re-renders
state.user.profile.age = 30      // Profile does NOT re-render
```

**No selectors. No manual subscriptions. Just access what you need.**

## Updating State

Just mutate directly:

```typescript
const [state, update] = createStore({
  count: 0,
  user: { name: 'John' },
  items: ['a', 'b']
})

// Direct mutations
state.count = 5
state.user.name = 'Jane'
state.items.push('c')
```

## Effects & Computed

```typescript
import { effect, computed } from '@supergrain/core'

// Run side effects when state changes
effect(() => {
  console.log('Count is now:', state.count)
})

// Derived values that update automatically  
const doubled = computed(() => state.count * 2)
console.log(doubled()) // Reactive!
```

## React Components

```typescript
import { useTrackedStore, For } from '@supergrain/react'
import { memo } from 'react'

const TodoItem = memo(({ todo }) => (
  <div>
    <span>{todo.text}</span>
    <button onClick={() => todo.completed = !todo.completed}>
      Toggle
    </button>
  </div>
))

function TodoList() {
  const state = useTrackedStore(store)

  return (
    <For each={state.todos} fallback={<p>No todos</p>}>
      {todo => <TodoItem key={todo.id} todo={todo} />}
    </For>
  )
}
```

## TypeScript

Full type inference out of the box:

```typescript
interface AppState {
  user: { name: string; age: number }
  items: Array<{ id: string; title: string }>
}

const [store, update] = createStore<AppState>({
  user: { name: 'John', age: 30 },
  items: []
})

// TypeScript knows the types
store.user.name = 'Jane'     // OK
store.user.name = 123        // Error!
```

---

## Bonus: MongoDB-Style Operators

For complex updates, you can use MongoDB-style operators:

```typescript
const [state, update] = createStore({ count: 0, items: [] })

// $set - Set values
update({ $set: { count: 10 } })
update({ $set: { 'user.name': 'Alice' } })

// $inc - Increment
update({ $inc: { count: 1 } })

// $push / $pull - Array operations
update({ $push: { items: 'new item' } })
update({ $pull: { items: 'old item' } })

// $addToSet - Add unique
update({ $addToSet: { tags: 'react' } })

// Batch multiple operations
update({
  $set: { 'user.name': 'Bob' },
  $inc: { count: 2 },
  $push: { items: 'another' }
})
```

**Available operators:** `$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, `$rename`, `$min`, `$max`

---

## Links

- [GitHub](https://github.com/commoncurriculum/supergrain)
- [Core Source](https://github.com/commoncurriculum/supergrain/tree/main/packages/core/src)
- [React Integration](https://github.com/commoncurriculum/supergrain/tree/main/packages/react/src)

</div>
