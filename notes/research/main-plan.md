# Todo App Feature Testing Plan

> **TL;DR:** Plan for 8 new tests (4 core, 4 React) covering CRUD operations on a todo list store. Tests validate both store-level reactivity and React component re-rendering.

**Status:** Plan only (not yet implemented)

---

## Data Structures

```typescript
interface Task {
  id: string
  isCompleted: boolean
  text: string
}

interface UserTaskList {
  id: string
  firstName: string
  tasks: Array<Task>
}
```

---

## Test Matrix

| Feature | Core Test | React Test |
|---|---|---|
| Add todo | Append task to `tasks` array, assert it's present | Trigger add, assert component re-renders with new task |
| Remove todo | Remove task by `id`, assert it's gone | Trigger remove, assert task disappears from rendered output |
| Update todo text | Update `text` by `id`, assert new value | Trigger update, assert component shows updated text |
| Mark todo complete | Toggle `isCompleted`, assert new state | Trigger toggle, assert UI reflects completion (e.g. CSS class) |

---

## Test Locations

- **Core:** `packages/core/tests/array.test.ts` (or new `tests/todo.test.ts`)
- **React:** `packages/react/tests/use-store.test.tsx` (or new `tests/use-store-todo.test.tsx`)

## Implementation Notes

- Each core test: create store with initial `UserTaskList`, apply operation, assert store state
- Each React test: render component using `useStore`, trigger action, assert DOM output
- All React state updates must be wrapped in `act()` per project conventions
