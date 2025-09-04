# React Todo App - Storable Example

This is a classic Todo application built with React and the `@commoncurriculum/storable` library. It demonstrates how to use the library's React hooks for local-first data management with signals-based reactivity.

## Features

- ✅ Add new todos
- ✅ Mark todos as complete/incomplete
- ✅ Edit todo text (double-click or use edit button)
- ✅ Delete todos
- ✅ Real-time UI updates using signals
- ✅ Local-first architecture (no network requests)
- ✅ TypeScript for type safety
- ✅ Responsive design

## Architecture

This app demonstrates the Phase 1 capabilities of the storable library:

### Data Storage
- Uses `DocumentStore` for local document storage
- Each todo is stored as a separate document with type `'todo'`
- Todo list metadata is stored as a document with type `'todoList'`
- Documents are automatically reactive via signals

### React Integration
- `useDocument<T>(store, type, id)` - Hook for single document reactivity
- `useDocuments<T>(store, type, ids)` - Hook for multiple document reactivity
- Components automatically re-render when document data changes
- Proper cleanup and memory management

### Local-First Design
- All data operations are local (no network requests)
- Immediate UI updates with signals-based reactivity
- Demonstrates the ergonomics before adding network complexity

## Running the App

From the root of this directory:

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The app will be available at `http://localhost:3001`.

## Code Structure

- `src/types.ts` - TypeScript interfaces for Todo and TodoList
- `src/store.ts` - Store instance and utility functions
- `src/App.tsx` - Main application component
- `src/components/` - React components
  - `TodoList.tsx` - Main todo list container
  - `AddTodo.tsx` - Form for adding new todos
  - `TodoItem.tsx` - Individual todo item with edit/delete
- `src/App.css` - Styling for the entire application

## Key Patterns Demonstrated

### Document Storage
```typescript
// Store a todo document
store.setDocument('todo', todo.id, todo)

// Get a todo document (reactive)
const todo = useDocument<Todo>(store, 'todo', todoId)
```

### Batch Document Access
```typescript
// Get multiple todos reactively
const todos = useDocuments<Todo>(store, 'todo', todoIds)
```

### Local Mutations
```typescript
// Update a document locally
const updatedTodo = { ...todo, completed: !todo.completed }
store.setDocument('todo', todo.id, updatedTodo)
```

### Memory Management
- Documents are automatically cleaned up when no longer referenced
- React hooks handle signal subscription/cleanup lifecycle
- No memory leaks from signal subscriptions

This example validates the local-first development experience before adding network synchronization in later phases.
