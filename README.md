# Supergrain

A fast, ergonomic reactive store for React.

- **Plain objects** — read properties, assign values, push to arrays. No special syntax.
- **Fine-grained** — only the components that read changed properties re-render
- **Synchronous** — state updates are immediate, not deferred to the next render
- **Type-safe** — full TypeScript inference on stores and mutations
- **Zero boilerplate** — no actions, reducers, selectors, or providers

| | Boilerplate | Reactivity | State updates | Mutation style |
|---|---|---|---|---|
| **Supergrain** | None | Property-level | Synchronous | Direct assignment |
| **useState/useReducer** | Low | Component-level | Async (next render) | setState / dispatch |
| **Redux/RTK** | High | Selector-based | Async (next render) | Immutable reducers |
| **Zustand** | Low | Selector-based | Async (next render) | set() callback |
| **Jotai/Recoil** | Low | Atom-level | Async (next render) | Atom setters |
| **MobX** | Medium | Property-level | Synchronous | Direct assignment |

## Install

```bash
npm install @supergrain/core @supergrain/react
```

## Quick Start

```typescript
// [#DOC_TEST_32](packages/doc-tests/tests/readme-react.test.tsx)

import { createStore, computed, effect } from '@supergrain/core'
import { tracked, For } from '@supergrain/react'

interface Todo { id: number; text: string; completed: boolean }

const [store] = createStore<{ todos: Todo[] }>({
  todos: [
    { id: 1, text: 'Learn Supergrain', completed: false },
    { id: 2, text: 'Build something', completed: false },
  ],
})

const TodoItem = tracked(({ todo }: { todo: Todo }) => (
  <li>
    <input
      type="checkbox"
      checked={todo.completed}
      onChange={() => todo.completed = !todo.completed}
    />
    {todo.text}
  </li>
))

const App = tracked(() => {
  const remaining = computed(() => store.todos.filter(t => !t.completed).length)

  effect(() => document.title = `${remaining()} items left`)

  return (
    <div>
      <h1>Todos ({remaining()})</h1>
      <For each={store.todos}>
        {todo => <TodoItem key={todo.id} todo={todo} />}
      </For>
    </div>
  )
})
```

Checking a todo re-renders only that `TodoItem` — the `App` component and other items don't re-render.

## Fine-Grained Reactivity

`tracked()` subscribes a component to only the specific properties it reads during render — at any depth:

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

No manual subscription management. No selectors. Just access the data and the reactivity system handles the rest. `tracked()` also includes `React.memo()` behavior, so you never need both.

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
