# Todo App Feature Testing Plan

This document outlines the plan for adding tests to the `core` and `react` packages to support the features of a todo application. In total, 8 new tests will be created: 4 for `core` and 4 for `react`.

## Data Structures

The tests will be based on the following data structures:

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

## 1. Add Todo

### Core Test (`packages/core`)

- **File:** `tests/array.test.ts` (or a new `tests/todo.test.ts`)
- **Description:** A test will be written to verify that a new `Task` object can be successfully appended to the `tasks` array within the `UserTaskList` store. This will involve creating a store with an initial `UserTaskList`, applying an "add" operation, and asserting that the `tasks` array contains the newly added task.

### React Test (`packages/react`)

- **File:** `tests/use-store.test.tsx` (or a new `tests/use-store-todo.test.tsx`)
- **Description:** A test will be created to ensure the `useStore` hook correctly updates the component when a new task is added. This test will render a component that uses the store, trigger an action to add a task, and then assert that the component re-renders with the new task visible.

---

## 2. Remove Todo

### Core Test (`packages/core`)

- **File:** `tests/array.test.ts` (or a new `tests/todo.test.ts`)
- **Description:** This test will ensure that a specific task can be removed from the `tasks` array based on its `id`. It will initialize a store with a list of tasks, perform a "remove" operation, and assert that the task with the specified `id` is no longer present in the `tasks` array.

### React Test (`packages/react`)

- **File:** `tests/use-store.test.tsx` (or a new `tests/use-store-todo.test.tsx`)
- **Description:** This test will verify that removing a task from the store triggers a re-render in the component using the `useStore` hook. The test will render a component displaying a list of tasks, simulate a user action to remove one, and assert that the removed task is no longer present in the rendered output.

---

## 3. Update Todo Text

### Core Test (`packages/core`)

- **File:** `tests/array.test.ts` (or a new `tests/todo.test.ts`)
- **Description:** This test will confirm that the `text` property of a specific task can be updated. It will involve finding a task by its `id` within the `tasks` array, applying an "update text" operation, and asserting that the `text` property of that task has been changed to the new value.

### React Test (`packages/react`)

- **File:** `tests/use-store.test.tsx` (or a new `tests/use-store-todo.test.tsx`)
- **Description:** This test will check that updating a task's text in the store is reflected in the component. It will render a component, trigger an action to update the text of a task, and assert that the component re-renders to display the updated text.

---

## 4. Mark Todo as Completed

### Core Test (`packages/core`)

- **File:** `tests/array.test.ts` (or a new `tests/todo.test.ts`)
- **Description:** This test will verify that the `isCompleted` status of a task can be toggled (e.g., from `false` to `true`). It will initialize a store, find a task by `id`, apply an operation to change its completion status, and assert that the `isCompleted` property has been updated correctly.

### React Test (`packages/react`)

- **File:** `tests/use-store.test.tsx` (or a new `tests/use-store-todo.test.tsx`)
- **Description:** This final test will ensure that changes to a task's `isCompleted` status are propagated to the UI. It will render a component, simulate an action to mark a task as complete, and assert that the component's output reflects this change (e.g., a "completed" class is added).
