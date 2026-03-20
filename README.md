# Supergrain

A fast, ergonomic reactive store for React. Work with plain objects — read properties, assign values, push to arrays — and get fine-grained reactivity that only re-renders the components that need it. No actions, no reducers, no selectors, no boilerplate.

**[Full Documentation](https://commoncurriculum.github.io/supergrain/)**

## Install

```bash
npm install @supergrain/core @supergrain/react
```

## Quick Start

```typescript
// [#DOC_TEST_32](packages/doc-tests/tests/readme-react.test.tsx)

import { createStore, effect } from '@supergrain/core'
import { tracked } from '@supergrain/react'

// Create a store — it's just an object
interface State { count: number; user: { name: string } }

const [store] = createStore<State>({ count: 0, user: { name: 'John' } })

// Mutate directly — fully type-checked
store.user.name = 'Jane'   // ✅
store.user.name = 123      // ❌ TypeScript error
store.count = 5

// Effects react to changes
effect(() => console.log('Count:', store.count))

// Components only re-render when properties they read change
const Name = tracked(() => <h1>{store.user.name}</h1>)   // won't re-render when count changes
const Count = tracked(() => <p>{store.count}</p>)         // won't re-render when name changes
```

## Fine-Grained Reactivity

Every property access inside a `tracked()` component creates a subscription to that specific property. Nothing more:

```typescript
// [#DOC_TEST_34](packages/doc-tests/tests/readme-react.test.tsx)

const [store] = createStore({ x: 1, y: 2, z: 3 })

const ShowX = tracked(() => <div>X: {store.x}</div>)  // re-renders when x changes
const ShowY = tracked(() => <div>Y: {store.y}</div>)  // re-renders when y changes

store.z = 10  // neither component re-renders
```

This works at any depth:

```typescript
// [#DOC_TEST_35](packages/doc-tests/tests/readme-react.test.tsx)

const [store] = createStore({
  user: { profile: { name: 'Alice', age: 30 } },
  items: [{ title: 'Item 1' }, { title: 'Item 2' }],
})

const Profile = tracked(() => {
  // Subscribes to ONLY user.profile.name — not age, not items
  return <h1>{store.user.profile.name}</h1>
})

store.user.profile.age = 31  // Profile does NOT re-render
store.user.profile.name = 'Bob'  // Profile re-renders
```

No manual subscription management. No selectors. Just access the data and the reactivity system handles the rest.

## tracked() Replaces memo()

`tracked()` includes `React.memo()` behavior, so you never need both:

```typescript
// [#DOC_TEST_36](packages/doc-tests/tests/readme-react.test.tsx)

const [store] = createStore({
  tasks: [
    { id: 1, title: 'Task 1', completed: false },
    { id: 2, title: 'Task 2', completed: true },
  ],
})

const TaskRow = tracked(({ taskId }: { taskId: number }) => {
  const task = store.tasks.find(t => t.id === taskId)
  return (
    <div>
      <h3>{task.title}</h3>
      <span>{task.completed ? 'Done' : 'Pending'}</span>
    </div>
  )
})

const TaskList = tracked(() => (
  <div>
    {store.tasks.map(task => (
      <TaskRow key={task.id} taskId={task.id} />
    ))}
  </div>
))
```

Each `TaskRow` independently subscribes to only the signals it reads. Changing one task's title only re-renders that row.

## Effects

React to state changes outside of components:

```typescript
// [#DOC_TEST_37](packages/doc-tests/tests/readme-core.test.ts)

import { effect } from '@supergrain/core'

const [state] = createStore({ count: 0 })

effect(() => {
  console.log('Count changed to:', state.count)
})

effect(() => {
  localStorage.setItem('count', String(state.count))
})
```

## Computed Values

Derive values that update automatically:

```typescript
// [#DOC_TEST_38](packages/doc-tests/tests/readme-core.test.ts)

import { computed } from '@supergrain/core'

const [state] = createStore({
  todos: [
    { id: 1, text: 'Task 1', completed: false },
    { id: 2, text: 'Task 2', completed: true },
  ],
})

const completedCount = computed(() =>
  state.todos.filter(t => t.completed).length
)

console.log(completedCount()) // 1

state.todos[0].completed = true
console.log(completedCount()) // 2
```

## For Component

Optimized array rendering with automatic version tracking for `React.memo` components:

```typescript
// [#DOC_TEST_39](packages/doc-tests/tests/readme-react.test.tsx)

import { For } from '@supergrain/react'
import { memo } from 'react'

const [store] = createStore({
  todos: [
    { id: 1, text: 'Task 1', completed: false },
    { id: 2, text: 'Task 2', completed: true },
  ],
})

const TodoItem = memo(({ todo }: { todo: any }) => (
  <div className={todo.completed ? 'completed' : ''}>
    {todo.text}
  </div>
))

const TodoList = tracked(() => (
  <For each={store.todos} fallback={<div>No todos yet</div>}>
    {(todo) => <TodoItem key={todo.id} todo={todo} />}
  </For>
))
```

## TypeScript

`createStore` infers the full type from your initial state. Direct mutations are type-checked — you can't assign the wrong type to a property:

```typescript
// [#DOC_TEST_40](packages/doc-tests/tests/readme-core.test.ts)

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

const [store] = createStore<AppState>({
  user: {
    name: 'John',
    age: 30,
    preferences: { theme: 'light', notifications: true }
  },
  items: []
})

store.user.name = 'Jane'           // ✅ string
store.user.preferences.theme = 'dark'  // ✅ 'light' | 'dark'
```

Component usage is also fully typed:

```typescript
// [#DOC_TEST_41](packages/doc-tests/tests/readme-react.test.tsx)

const UserProfile = tracked(() => (
  <div>
    <h1>{store.user.name}</h1>
    <p>Age: {store.user.age}</p>
  </div>
))
```

---

## Update Operators

For complex updates — batched mutations, array manipulations, dot-notation paths — `createStore` returns an `update` function with MongoDB-style operators:

```typescript
// [#DOC_TEST_46](packages/doc-tests/tests/readme-core.test.ts)

const [state, update] = createStore({
  count: 0,
  user: { name: 'John', age: 30, middleName: 'M' },
  items: ['a', 'b', 'c'],
  tags: ['react'],
  lowestScore: 100,
  highestScore: 50,
})

// $set — set values (supports dot notation for nested paths)
update({ $set: { count: 10, 'user.name': 'Alice' } })

// $unset — remove fields
update({ $unset: { 'user.middleName': 1 } })

// $inc — increment/decrement numbers
update({ $inc: { count: 1 } })
update({ $inc: { count: -5 } })

// $push — add to arrays (with $each for multiple)
update({ $push: { items: 'd' } })
update({ $push: { items: { $each: ['e', 'f'] } } })

// $pull — remove from arrays
update({ $pull: { items: 'b' } })

// $addToSet — add only if not already present
update({ $addToSet: { tags: 'vue' } })

// $min / $max — conditional updates
update({ $min: { lowestScore: 50 } })
update({ $max: { highestScore: 100 } })

// Batching — multiple operators in one call
update({
  $set: { 'user.name': 'Bob' },
  $inc: { count: 2 },
  $push: { items: 'g' },
})
```

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development

```bash
git clone https://github.com/commoncurriculum/supergrain.git
cd supergrain
pnpm install
pnpm -r --filter="@supergrain/*" build
pnpm test
pnpm run typecheck
```

### Publishing Releases

This project uses [Changesets](https://github.com/changesets/changesets) for automated releases. You can create changesets via:

- **GitHub UI**: Use the [Add Changeset workflow](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml) (no terminal needed!)
- **Terminal**: Run `pnpm changeset`

GitHub Actions automatically handles versioning, changelogs, and publishing to NPM.

- [NPM_SETUP.md](NPM_SETUP.md) - Complete guide for setting up NPM publishing
- [RELEASING.md](RELEASING.md) - Step-by-step instructions for creating releases

## License

MIT
