# React/Vue Data Sync Service Migration Plan

This document outlines the plan for migrating the sophisticated Ember data synchronization service to React/Vue, based on the comprehensive analysis in `ember-architecture-analysis.md`.

## Progress Tracking

### Phase 1: Read-Only Data Fetching with Signals

- [x] **1.1 TypeScript Library Setup** - Complete ✅
- [ ] **1.2 Core Store with Signals**
- [ ] **1.3 HTTP Client**
- [ ] **1.4 Finder Service**
- [ ] **1.5 Framework Adapters - React**
- [ ] **1.6 Framework Adapters - Vue**
- [ ] **1.7 Loading States and Error Handling**

### Phase 2: Data Mutations and Optimistic Updates

- [ ] **2.1 Action System**
- [ ] **2.2 Patch System**
- [ ] **2.3 Optimistic Updates**

### Phase 3: Real-time Synchronization and Advanced Features

- [ ] **3.1 WebSocket Infrastructure**
- [ ] **3.2 Real-time Patch Processing**
- [ ] **3.3 Conflict Resolution**

## Overview

The current Ember system provides:

- Real-time data synchronization via WebSockets
- Offline-first data storage with local caching
- Optimistic updates with server reconciliation
- Conflict resolution and retry mechanisms
- Action-based state management

**Migration will be split into distinct phases:**

- **Phase 1**: Read-only data fetching with signals-based reactivity
- **Phase 2**: Data mutations and optimistic updates
- **Phase 3**: Real-time synchronization and conflict resolution

## Project Structure

This migration will create a TypeScript library in this repository that can be consumed by both React and Vue applications. The library will be framework-agnostic at its core with framework-specific adapters.

```
src/
├── core/                    # Framework-agnostic core library
│   ├── store/               # Document storage with signals
│   ├── finder/              # API fetching service
│   ├── http/                # HTTP client
│   └── types/               # TypeScript type definitions
├── react/                   # React-specific hooks
├── vue/                     # Vue-specific composables
└── __tests__/               # Comprehensive test suite
```

## Test-First Design Approach

All development will follow Test-Driven Development (TDD) principles:

1. **Write failing tests** that describe the desired behavior
2. **Implement minimal code** to make tests pass
3. **Refactor** while keeping tests green
4. **Repeat** for each feature increment

### Testing Strategy

- **Unit Tests**: Test individual functions and classes in isolation
- **Integration Tests**: Test service interactions and data flow
- **Contract Tests**: Ensure framework adapters maintain consistent APIs
- **End-to-End Tests**: Test complete user workflows
- **Performance Tests**: Validate memory usage and response times

## Phase 1: Read-Only Data Fetching with Signals

This phase focuses SOLELY on fetching data from APIs and making it available to components through reactive signals. No mutations, no WebSockets, no optimistic updates.

### 1.1 TypeScript Library Setup

**Tasks:**

- Set up TypeScript project configuration with strict mode
- Configure Vite build pipeline for library distribution
- Set up Vitest testing framework with TypeScript support
- Configure ESLint and Prettier for code quality
- Set up GitHub Actions for CI/CD
- Create package.json for npm publishing
- Install and configure signals library (e.g., @preact/signals-core)

### 1.2 Core Store with Signals (Test-First)

**Document Store Development:**

_First, write tests for:_

- Document storage and retrieval by type and ID
- Signal creation and updates when documents change
- Type-safe document access
- Memory management and cleanup
- Cache invalidation strategies

_Then implement:_

- `DocumentStore` class using signals for reactive document storage
- Type-safe document storage: `store[type][id]` with signal values
- Document retrieval with automatic signal creation
- Cache management and memory cleanup
- Signal subscription and cleanup utilities

**Key Features:**

- Each document is stored as a signal: `signal<Document | null>`
- Components automatically re-render when document signals change
- Type-safe access to documents with proper TypeScript generics
- Automatic cleanup of unused document signals

### 1.3 HTTP Client (Test-First)

**API Client Development:**

_First, write tests for:_

- GET requests with proper serialization
- Error handling with user-friendly messages
- Request timeout and retry logic
- Response caching strategies
- Network failure scenarios

_Then implement:_

- `HttpClient` class with configurable base URL
- Request/response interceptors
- Error classification and handling
- Retry logic with exponential backoff
- Response caching with TTL

### 1.4 Finder Service (Test-First)

**Batch Fetching Service:**

_First, write tests for:_

- Single document fetching from API
- Batch document fetching with deduplication
- Request queuing and optimization
- Loading state management
- Error handling per document

_Then implement:_

- `FinderService` that fetches documents from API
- Request batching to reduce HTTP calls
- Integration with DocumentStore to update signals
- Loading state signals per document type
- Error handling with per-document error states

**Key Features:**

- `finder.findOne(type, id)` - fetches single document, updates store signal
- `finder.findMany(type, ids)` - batches requests, updates multiple signals
- Automatic deduplication of simultaneous requests
- Loading signals: `isLoading.value` for each document type
- Error signals: `error.value` for each document

### 1.5 Framework Adapters - React (Test-First)

**React Hooks Development:**

_First, write tests for:_

- `useDocument(type, id)` hook behavior and re-rendering
- Loading state tracking and updates
- Error state handling
- Cleanup on component unmount
- TypeScript integration and type safety

_Then implement:_

- `useDocument<T>(type: string, id: string)` hook
- `useDocuments<T>(type: string, ids: string[])` hook
- `useDocumentStore()` for direct store access
- Integration with signals for automatic re-rendering
- Proper cleanup and memory management

**Hook Signatures:**

```typescript
function useDocument<T>(
  type: string,
  id: string
): {
  data: T | null
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

function useDocuments<T>(
  type: string,
  ids: string[]
): {
  data: (T | null)[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}
```

### 1.6 Framework Adapters - Vue (Test-First)

**Vue Composables Development:**

_First, write tests for:_

- Composable reactivity with Vue's reactive system
- Integration with signals library
- Cleanup on component unmount
- TypeScript integration
- Performance with large datasets

_Then implement:_

- `useDocument<T>(type: string, id: string)` composable
- `useDocuments<T>(type: string, ids: string[])` composable
- Integration between signals and Vue reactivity
- Proper cleanup with `onUnmounted`

### 1.7 Loading States and Error Handling (Test-First)

**Loading State Management:**

_First, write tests for:_

- Global loading states per document type
- Individual document loading states
- Error state persistence and clearing
- Loading state transitions
- Performance under concurrent requests

_Then implement:_

- Loading signals that track fetch operations
- Error signals with structured error information
- Loading state aggregation (e.g., "any loading", "all loading")
- Error recovery mechanisms

## Phase 2: Data Mutations and Optimistic Updates

This phase adds the ability to modify data with optimistic updates, but still no real-time synchronization.

### 2.1 Action System (Test-First)

**Action Definition and Dispatching:**

_First, write tests for:_

- Action validation and structure
- Optimistic patch application to signals
- Undo patch generation
- Action queuing per document
- Server submission and response handling

_Then implement:_

- `ActionService` for dispatching mutations
- Action structure with patches and undo patches
- Optimistic application to document signals
- Server submission with rollback on failure

### 2.2 Patch System (Test-First)

**MongoDB-style Operations:**

_First, write tests for:_

- Patch operations (set, unset, inc, push, pull, etc.)
- Patch application to document signals
- Undo patch generation accuracy
- Path creation for nested objects
- Type safety for patch operations

_Then implement:_

- Patch application engine
- Rewind function generation
- Path utilities for nested operations
- Type-safe patch definitions

### 2.3 Optimistic Updates (Test-First)

**Optimistic Queue Management:**

_First, write tests for:_

- Optimistic queue per document
- Server confirmation and queue cleanup
- Rollback on server rejection
- Queue persistence during failures
- Memory management

_Then implement:_

- Optimistic update tracking
- Queue management per document
- Automatic rollback mechanisms
- Server reconciliation without conflicts

## Phase 3: Real-time Synchronization and Advanced Features

This phase adds WebSocket support, real-time updates, and conflict resolution.

### 3.1 WebSocket Infrastructure (Test-First)

**Socket Service:**

_First, write tests for:_

- WebSocket connection management
- Long-polling fallback
- Connection lifecycle
- Heartbeat system
- Activity-based connection management

_Then implement:_

- `SocketService` with multi-transport support
- Connection state management
- Automatic reconnection
- Activity monitoring

### 3.2 Real-time Patch Processing (Test-First)

**Incoming Update Handling:**

_First, write tests for:_

- Sequence number validation
- Patch application to signals
- Missing patch recovery
- Document staleness detection
- Subscription management

_Then implement:_

- Real-time patch processing
- Document subscriptions
- Automatic signal updates
- Conflict detection

### 3.3 Conflict Resolution (Test-First)

**Server Reconciliation:**

_First, write tests for:_

- Three-stage reconciliation process
- Optimistic queue replay
- Conflict detection accuracy
- Data consistency guarantees
- User notification of conflicts

_Then implement:_

- Conflict resolution algorithms
- Automatic reconciliation
- User-friendly conflict handling
- Data integrity validation

## Technical Architecture

### Phase 1 Core Services

```
DataFetchLibrary
├── DocumentStore (signals-based document storage)
├── HttpClient (API communication)
├── FinderService (document fetching)
└── Framework Adapters (React hooks / Vue composables)
```

### Signals Integration

```typescript
// Core store structure
class DocumentStore {
  private documents = new Map<string, Signal<Document | null>>()

  getDocument<T>(type: string, id: string): Signal<T | null> {
    const key = `${type}:${id}`
    if (!this.documents.has(key)) {
      this.documents.set(key, signal<T | null>(null))
    }
    return this.documents.get(key)!
  }

  setDocument<T>(type: string, id: string, doc: T): void {
    const docSignal = this.getDocument<T>(type, id)
    docSignal.value = doc
  }
}
```

### Framework-Specific Usage

**React Pattern:**

```tsx
function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading, error } = useDocument<User>('user', userId)

  if (isLoading) return <Loading />
  if (error) return <Error error={error} />
  if (!user) return <NotFound />

  return <div>Hello {user.name}!</div>
}
```

**Vue Pattern:**

```vue
<script setup lang="ts">
const props = defineProps<{ userId: string }>()
const { data: user, isLoading, error } = useDocument<User>('user', props.userId)
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else-if="error">{{ error.message }}</div>
  <div v-else-if="user">Hello {{ user.name }}!</div>
  <div v-else>User not found</div>
</template>
```

## Development Workflow

### TDD Two-Commit Strategy

**Each feature MUST be implemented using exactly two commits:**

1. **RED Commit**: `test: add failing tests for [feature name]`
   - Write comprehensive failing tests that describe the desired behavior
   - Tests should fail with clear error messages
   - CI should fail on this commit
   - Commit message format: `test: add failing tests for [feature]`

2. **GREEN Commit**: `feat: implement [feature name] to pass tests`
   - Write minimal implementation to make all tests pass
   - No additional features beyond what tests require
   - CI should pass on this commit
   - Commit message format: `feat: implement [feature] to pass tests`

**Example workflow:**

```bash
# Step 1: Write failing tests
git add src/**/*.test.ts
git commit -m "test: add failing tests for DocumentStore signal management"

# Step 2: Implement feature to pass tests
git add src/core/store/
git commit -m "feat: implement DocumentStore signal management to pass tests"
```

### TDD Cycle for Each Feature

1. **Red**: Write failing test that describes the desired behavior
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Improve code quality while keeping tests green
4. **Repeat**: Continue with next smallest increment

### Phase 1 Success Criteria

- [ ] Documents can be fetched from API endpoints
- [ ] Document signals automatically update components
- [ ] React hooks provide proper loading/error states
- [ ] Vue composables integrate with Vue reactivity
- [ ] Batch fetching reduces HTTP requests
- [ ] Memory usage is optimized with signal cleanup
- [ ] TypeScript provides full type safety
- [ ] 100% test coverage for all Phase 1 features
- [ ] No mutations, WebSockets, or real-time features (read-only)

### Code Quality Standards

- **100% Test Coverage**: All code must have corresponding tests
- **TypeScript Strict Mode**: Full type safety with no `any` types
- **ESLint Rules**: Enforce consistent code style
- **Performance Budgets**: Memory and timing thresholds
- **Documentation**: JSDoc comments for all public APIs

## Deliverables

**Phase 1:**

- **TypeScript Core Library**: Document store with signals, HTTP client, finder service
- **React Package**: `useDocument` and `useDocuments` hooks
- **Vue Package**: Equivalent composables with Vue integration
- **Test Suite**: Comprehensive test coverage for read-only functionality
- **Documentation**: API docs and usage examples for data fetching

This restructured plan focuses Phase 1 purely on read-only data fetching with signals-based reactivity, leaving all mutation and real-time features for later phases.
