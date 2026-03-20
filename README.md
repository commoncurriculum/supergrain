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

import { createStore } from '@supergrain/core'
import { tracked } from '@supergrain/react'

const [store] = createStore({
  count: 0,
  user: { name: 'John' },
})

const App = tracked(() => (
  <div>
    <h1>{store.user.name}: {store.count}</h1>
    <button onClick={() => store.count++}>Increment</button>
  </div>
))
```

That's it. `createStore` wraps your object in a reactive proxy. `tracked()` wraps a React component so it automatically subscribes to the store properties it reads. When those properties change, only that component re-renders.

## Synchronous State

With React's `useState`, state updates are deferred until the next render — you can't read back what you just wrote:

```typescript
// [#DOC_TEST_33](packages/doc-tests/tests/readme-core.test.ts)

// React useState: state is stale until next render
const [count, setCount] = useState(0);
setCount(5);
console.log(count); // still 0
```

Supergrain state is synchronous. Mutations are reflected immediately:

```typescript
// [#DOC_TEST_31](packages/doc-tests/tests/readme-core.test.ts)

const [state] = createStore({ count: 0, user: { name: 'John' } });

state.count = 5;
console.log(state.count); // 5

state.user.name = 'Jane';
console.log(state.user.name); // 'Jane'
```

React components still re-render on React's schedule, but the state itself is never stale. Event handlers, effects, computed values, and other store reads always see the latest value the instant it's written.

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

## Document Store (`@supergrain/store`)

For app-level data management, `@supergrain/store` provides a document-oriented store with a promise-like reactive API.

```bash
npm install @supergrain/store
```

### Setup

```typescript
// [#DOC_TEST_42](packages/doc-tests/tests/readme-store.test.tsx)

import { Store } from '@supergrain/store'

interface DocumentTypes {
  users: { id: number; firstName: string; lastName: string; email: string }
  posts: { id: number; title: string; content: string; userId: number }
}

const store = new Store<DocumentTypes>(async (modelType, id) => {
  const response = await fetch(`/api/${modelType}/${id}`)
  return response.json()
})
```

### Finding Documents

```typescript
// [#DOC_TEST_43](packages/doc-tests/tests/readme-store.test.tsx)

const doc = store.findDoc('posts', 1)

doc.content      // T | undefined — the document data
doc.isPending    // request in progress
doc.isFulfilled  // request succeeded
doc.isRejected   // request failed
```

### Setting Documents Directly

```typescript
// [#DOC_TEST_44](packages/doc-tests/tests/readme-store.test.tsx)

store.setDocument('users', 1, {
  id: 1,
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
})

const user = store.findDoc('users', 1)
user.isFulfilled  // true
user.content      // { id: 1, firstName: 'Jane', ... }
```

### React Usage

```typescript
// [#DOC_TEST_45](packages/doc-tests/tests/readme-store.test.tsx)

function PostView() {
  const post = store.findDoc('posts', 1)
  const user = store.findDoc('users', post.content?.userId)

  if (post.isPending) return <div>Loading...</div>
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

---

## Update Operators

For complex updates — batched mutations, array manipulations, dot-notation paths — `createStore` returns an `update` function with MongoDB-style operators:

```typescript
// [#DOC_TEST_46](packages/doc-tests/tests/readme-core.test.ts)

const [state, update] = createStore({
  count: 0,
  user: { name: 'John', age: 30 },
  items: ['a', 'b', 'c'],
  tags: ['react'],
})
```

### $set / $unset

```typescript
// [#DOC_TEST_47](packages/doc-tests/tests/readme-core.test.ts)

update({ $set: { count: 10 } })
update({ $set: { 'user.name': 'Alice' } })           // dot notation
update({ $unset: { 'user.middleName': 1 } })          // remove field
```

### $inc

```typescript
// [#DOC_TEST_48](packages/doc-tests/tests/readme-core.test.ts)

update({ $inc: { count: 1 } })
update({ $inc: { count: -5 } })                       // decrement
```

### $push / $pull / $addToSet

```typescript
// [#DOC_TEST_49](packages/doc-tests/tests/readme-core.test.ts)

update({ $push: { items: 'd' } })
update({ $push: { items: { $each: ['e', 'f'] } } })   // multiple
update({ $pull: { items: 'b' } })                      // remove by value
update({ $addToSet: { tags: 'vue' } })                 // add if not present
```

### $rename / $min / $max

```typescript
// [#DOC_TEST_50](packages/doc-tests/tests/readme-core.test.ts)

update({ $rename: { oldField: 'newField' } })
update({ $min: { lowestScore: 50 } })                  // only if smaller
update({ $max: { highestScore: 100 } })                // only if larger
```

### Batching

Multiple operators in a single `update()` call are batched into one synchronous transaction:

```typescript
// [#DOC_TEST_51](packages/doc-tests/tests/readme-core.test.ts)

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
