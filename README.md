# React/Vue Data Sync Service Migration Plan

This document outlines the plan for migrating the sophisticated Ember data synchronization service to React/Vue, based on the comprehensive analysis in `ember-architecture-analysis.md`.

## Progress Tracking

**Instructions:** Check off each checkbox `[ ]` → `[x]` as you complete each feature's 2-commit TDD cycle.

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

### 1.2 Core Store with Signals (Test-Then-Implement)

**Document Store Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Basic Document Storage**

- [ ] RED: Write tests for document storage and retrieval by type and ID
- [ ] GREEN: Implement `DocumentStore` class with basic storage

**Feature 2: Signal Integration**

- [ ] RED: Write tests for signal creation and updates when documents change
- [ ] GREEN: Implement signal-based reactive document storage

**Feature 3: Type Safety & Deep Tracking**

- [ ] RED: Write tests for type-safe document access and deep nested field change detection
- [ ] GREEN: Implement type-safe storage with deep tracking: `store[type][id]` with signal values that detect nested changes

**Feature 4: Memory Management**

- [ ] RED: Write tests for memory management and cleanup of unused signals
- [ ] GREEN: Implement cache management and automatic signal cleanup

**Feature 5: Signal Utilities**

- [ ] RED: Write tests for signal subscription and cleanup utilities
- [ ] GREEN: Implement signal subscription and cleanup utilities

**Key Features:**

- Each document is stored as a signal: `signal<Document | null>`
- **Deep tracking**: Signals must detect changes to deeply nested fields (e.g., `user.profile.settings.theme`) and trigger granular updates
- Components automatically re-render when document signals change at any nesting level
- Type-safe access to documents with proper TypeScript generics
- Automatic cleanup of unused document signals

### 1.3 HTTP Client (Test-Then-Implement)

**API Client Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Basic HTTP Client**

- [ ] RED: Write tests for GET requests with proper serialization
- [ ] GREEN: Implement `HttpClient` class with configurable base URL

**Feature 2: Error Handling**

- [ ] RED: Write tests for error handling with user-friendly messages
- [ ] GREEN: Implement error classification and handling

**Feature 3: Retry Logic**

- [ ] RED: Write tests for request timeout and retry logic
- [ ] GREEN: Implement retry logic with exponential backoff

**Feature 4: Response Caching**

- [ ] RED: Write tests for response caching strategies
- [ ] GREEN: Implement response caching with TTL

**Feature 5: Request Interceptors**

- [ ] RED: Write tests for network failure scenarios and interceptors
- [ ] GREEN: Implement request/response interceptors

### 1.4 Finder Service (Test-Then-Implement)

**Batch Fetching Service (each feature uses 2-commit TDD cycle):**

**Feature 1: Single Document Fetching**

- [ ] RED: Write tests for single document fetching from API
- [ ] GREEN: Implement `FinderService` that fetches documents from API

**Feature 2: Batch Fetching**

- [ ] RED: Write tests for batch document fetching with deduplication
- [ ] GREEN: Implement request batching to reduce HTTP calls

**Feature 3: Store Integration**

- [ ] RED: Write tests for request queuing and optimization
- [ ] GREEN: Implement integration with DocumentStore to update signals

**Feature 4: Loading States**

- [ ] RED: Write tests for loading state management per document type
- [ ] GREEN: Implement loading state signals per document type

**Feature 5: Error Handling**

- [ ] RED: Write tests for error handling per document
- [ ] GREEN: Implement error handling with per-document error states

**Key Features:**

- `finder.findOne(type, id)` - fetches single document, updates store signal
- `finder.findMany(type, ids)` - batches requests, updates multiple signals
- Automatic deduplication of simultaneous requests
- Loading signals: `isLoading.value` for each document type
- Error signals: `error.value` for each document

### 1.5 Framework Adapters - React (Test-Then-Implement)

**React Hooks Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Basic useDocument Hook**

- [ ] RED: Write tests for `useDocument(type, id)` hook behavior and re-rendering
- [ ] GREEN: Implement `useDocument<T>(type: string, id: string)` hook

**Feature 2: Loading and Error States**

- [ ] RED: Write tests for loading state tracking and error state handling
- [ ] GREEN: Implement loading/error state integration with hook

**Feature 3: Multiple Documents Hook**

- [ ] RED: Write tests for cleanup on component unmount
- [ ] GREEN: Implement `useDocuments<T>(type: string, ids: string[])` hook

**Feature 4: Direct Store Access**

- [ ] RED: Write tests for TypeScript integration and type safety
- [ ] GREEN: Implement `useDocumentStore()` for direct store access

**Feature 5: Memory Management**

- [ ] RED: Write tests for proper cleanup and memory management
- [ ] GREEN: Implement integration with signals for automatic re-rendering and cleanup

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

### 1.6 Framework Adapters - Vue (Test-Then-Implement)

**Vue Composables Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Basic useDocument Composable**

- [ ] RED: Write tests for composable reactivity with Vue's reactive system
- [ ] GREEN: Implement `useDocument<T>(type: string, id: string)` composable

**Feature 2: Signals Integration**

- [ ] RED: Write tests for integration with signals library
- [ ] GREEN: Implement integration between signals and Vue reactivity

**Feature 3: Multiple Documents Composable**

- [ ] RED: Write tests for cleanup on component unmount
- [ ] GREEN: Implement `useDocuments<T>(type: string, ids: string[])` composable

**Feature 4: TypeScript Integration**

- [ ] RED: Write tests for TypeScript integration and type safety
- [ ] GREEN: Implement proper TypeScript support for composables

**Feature 5: Performance & Cleanup**

- [ ] RED: Write tests for performance with large datasets
- [ ] GREEN: Implement proper cleanup with `onUnmounted` and optimization

### 1.7 Loading States and Error Handling (Test-Then-Implement)

**Loading State Management (each feature uses 2-commit TDD cycle):**

**Feature 1: Global Loading States**

- [ ] RED: Write tests for global loading states per document type
- [ ] GREEN: Implement loading signals that track fetch operations

**Feature 2: Individual Loading States**

- [ ] RED: Write tests for individual document loading states
- [ ] GREEN: Implement per-document loading state tracking

**Feature 3: Error State Management**

- [ ] RED: Write tests for error state persistence and clearing
- [ ] GREEN: Implement error signals with structured error information

**Feature 4: Loading Transitions**

- [ ] RED: Write tests for loading state transitions
- [ ] GREEN: Implement loading state aggregation (e.g., "any loading", "all loading")

**Feature 5: Concurrent Request Handling**

- [ ] RED: Write tests for performance under concurrent requests
- [ ] GREEN: Implement error recovery mechanisms and request deduplication

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
// Core store structure with deep tracking
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
    // Deep tracking: Signal detects nested changes like user.profile.settings.theme
    docSignal.value = doc
  }

  // Update nested field and trigger signal reactivity
  updateField<T>(type: string, id: string, path: string, value: any): void {
    const docSignal = this.getDocument<T>(type, id)
    if (docSignal.value) {
      // Immutable update that triggers signal change detection
      docSignal.value = setNestedValue(docSignal.value, path, value)
    }
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
   - **IMPORTANT**: Tests must fail because the functionality doesn't work, NOT because imports are missing
   - Provide minimal stub implementations (empty classes, functions that throw NotImplementedError, etc.) to make imports work
   - Tests should fail with clear error messages about missing behavior
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
