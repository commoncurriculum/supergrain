---
layout: home

hero:
  name: Supergrain
  text: Super Fine-Grained Reactivity
  tagline: A reactive store library powered by alien-signals. Track property access and update components with surgical precision using MongoDB-style operators.
  image:
    src: /hero-grain.svg
    alt: Supergrain Hero
  actions:
    - theme: brand
      text: Get Started
      link: #installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/commoncurriculum/supergrain

features:
  - icon: 🎯
    title: Super Fine-Grained Reactivity
    details: Only components using changed data re-render
  - icon: 🔄
    title: MongoDB-Style Operators
    details: Powerful update operations with automatic batching
  - icon: 📦
    title: Zero Boilerplate
    details: No actions, reducers, or decorators required
  - icon: ⚛️
    title: React Integration
    details: Simple hooks for reactive components
  - icon: 📝
    title: Full TypeScript Support
    details: Complete type safety and inference
  - icon: 🗂️
    title: Document-Oriented Store
    details: App-level store for document management with promise-like API
---

<div class="content-container">

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

For full documentation, see the [README](https://github.com/commoncurriculum/supergrain/blob/main/README.md).

</div>
