# React/Vue Data Sync Service Migration Plan

This document outlines the plan for migrating the sophisticated Ember data synchronization service to React/Vue, based on the comprehensive analysis in `ember-architecture-analysis.md`.

## Progress Tracking

**Instructions:** As an AI developer, you MUST check off the corresponding checkbox `[ ]` → `[x]` in this README file as you complete each task's RED and GREEN commits.

### Phase 1: Local-First Development & Framework Integration

- [x] **1.1 TypeScript Library Setup** - Complete ✅
- [x] **1.2 Core Store with Signals** - Complete ✅
- [ ] **1.3 Framework Adapters - React**
- [ ] **1.4 Framework Adapters - Vue**
- [ ] **1.5 Example App - React Todo App**
- [ ] **1.6 Example App - Vue Todo App**
- [ ] **1.7 Action System (Local Mutations)**
- [ ] **1.8 Patch System (Local Mutations)**

### Phase 2: Network Fetching and Optimistic Updates

- [ ] **2.1 HTTP Client**
- [ ] **2.2 Finder Service**
- [ ] **2.3 Loading States and Error Handling**
- [ ] **2.4 Optimistic Updates**

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

- **Phase 1**: Local-first development with framework integration. Focus on ergonomics and performance with sample React and Vue Todo apps before introducing network complexities.
- **Phase 2**: Network fetching and optimistic updates.
- **Phase 3**: Real-time synchronization and conflict resolution.

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
- **End-to-End Tests**: Test complete user workflows in the example apps.
- **Performance Tests**: Validate memory usage and response times.

## Phase 1: Local-First Development & Framework Integration

This phase focuses on building a robust, performant, and ergonomic local data store with framework adapters for React and Vue. We will build classic "Todo" apps for both frameworks to validate the design before adding any networking.

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

- [x] RED: Write tests for document storage and retrieval by type and ID
- [x] GREEN: Implement `DocumentStore` class with basic storage

**Feature 2: Signal Integration**

- [x] RED: Write tests for signal creation and updates when documents change
- [x] GREEN: Implement signal-based reactive document storage

**Feature 3: Type Safety & Deep Tracking**

- [x] RED: Write tests for type-safe document access and deep nested field change detection
- [x] GREEN: Implement type-safe storage with deep tracking: `store[type][id]` with signal values that detect nested changes

**Feature 4: Memory Management**

- [x] RED: Write tests for memory management and cleanup of unused signals
- [x] GREEN: Implement cache management and automatic signal cleanup

**Feature 5: Signal Utilities**

- [x] RED: Write tests for signal subscription and cleanup utilities
- [x] GREEN: Implement signal subscription and cleanup utilities

**Key Features:**

- Each document is stored as a signal: `signal<Document | null>`
- **Deep tracking**: Signals must detect changes to deeply nested fields (e.g., `user.profile.settings.theme`) and trigger granular updates
- Components automatically re-render when document signals change at any nesting level
- Type-safe access to documents with proper TypeScript generics
- Automatic cleanup of unused document signals

### 1.3 Framework Adapters - React (Test-Then-Implement)

**React Hooks Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Basic useDocument Hook**

- [x] RED: Write tests for `useDocument(type, id)` hook behavior and re-rendering
- [x] GREEN: Implement `useDocument<T>(type: string, id: string)` hook

**Feature 2: Multiple Documents Hook**

- [x] RED: Write tests for cleanup on component unmount
- [x] GREEN: Implement `useDocuments<T>(type: string, ids: string[])` hook

**Feature 3: Direct Store Access**

- [x] RED: Write tests for TypeScript integration and type safety
- [ ] GREEN: Implement `useDocumentStore()` for direct store access

**Feature 4: Memory Management**

- [ ] RED: Write tests for proper cleanup and memory management
- [ ] GREEN: Implement integration with signals for automatic re-rendering and cleanup

### 1.4 Framework Adapters - Vue (Test-Then-Implement)

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

### 1.5 Example App - React Todo App

Create a classic Todo application using the React framework adapters to validate ergonomics and performance.

### 1.6 Example App - Vue Todo App

Create a classic Todo application using the Vue framework adapters to validate ergonomics and performance.

### 1.7 Action System (Local Mutations) (Test-Then-Implement)

**Action System Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Action Validation and Structure**

- [ ] RED: Write tests for action validation and structure
- [ ] GREEN: Implement `ActionService` and basic action structure

**Feature 2: Local Patch Application**

- [ ] RED: Write tests for applying patches to document signals for local state changes
- [ ] GREEN: Implement patch application within the `ActionService`

### 1.8 Patch System (Local Mutations) (Test-Then-Implement)

**Patch System Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Basic Patch Operations (set, unset)**

- [ ] RED: Write tests for `set` and `unset` patch operations
- [ ] GREEN: Implement the patch application engine for `set` and `unset`

**Feature 2: Numeric Patch Operations (inc)**

- [ ] RED: Write tests for `inc` patch operation
- [ ] GREEN: Add `inc` support to the patch engine

**Feature 3: Array Patch Operations (push, pull)**

- [ ] RED: Write tests for `push` and `pull` array operations
- [ ] GREEN: Add array manipulation support to the patch engine

**Feature 4: Nested Path Operations**

- [ ] RED: Write tests for applying patches to nested object paths
- [ ] GREEN: Implement path utilities for nested operations

**Feature 5: Type Safety**

- [ ] RED: Write tests to ensure type safety for all patch operations
- [ ] GREEN: Implement type-safe patch definitions and application

## Phase 2: Network Fetching and Optimistic Updates

This phase adds the ability to fetch data from a server and modify it with optimistic updates.

### 2.1 HTTP Client (Test-Then-Implement)

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

### 2.2 Finder Service (Test-Then-Implement)

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

### 2.3 Loading States and Error Handling (Test-Then-Implement)

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

### 2.4 Optimistic Updates (Test-Then-Implement)

**Optimistic Update Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Optimistic Queue**

- [ ] RED: Write tests for creating and managing an optimistic update queue for a document
- [ ] GREEN: Implement optimistic update tracking and queue management per document

**Feature 2: Server Confirmation**

- [ ] RED: Write tests for server confirmation and queue cleanup
- [ ] GREEN: Implement logic to handle successful server responses and clean the queue

**Feature 3: Server Rejection and Rollback**

- [ ] RED: Write tests for rolling back changes on server rejection
- [ ] GREEN: Implement automatic rollback mechanisms

**Feature 4: Queue Persistence**

- [ ] RED: Write tests for queue persistence during network failures
- [ ] GREEN: Implement mechanisms to persist the queue (e.g., to localStorage)

**Feature 5: Memory Management**

- [ ] RED: Write tests for memory management of the optimistic queue
- [ ] GREEN: Implement cleanup for old, confirmed actions

## Phase 3: Real-time Synchronization and Advanced Features

This phase adds WebSocket support, real-time updates, and conflict resolution.

### 3.1 WebSocket Infrastructure (Test-Then-Implement)

**Socket Service Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Connection Management**

- [ ] RED: Write tests for basic WebSocket connection and lifecycle events (connect, disconnect, error)
- [ ] GREEN: Implement `SocketService` with connection state management

**Feature 2: Automatic Reconnection**

- [ ] RED: Write tests for automatic reconnection logic with backoff
- [ ] GREEN: Implement automatic reconnection in `SocketService`

**Feature 3: Heartbeat System**

- [ ] RED: Write tests for the heartbeat (ping/pong) system to keep connections alive
- [ ] GREEN: Implement the heartbeat mechanism

**Feature 4: Activity-Based Connection**

- [ ] RED: Write tests for activity-based connection management (e.g., disconnect after inactivity)
- [ ] GREEN: Implement activity monitoring to manage the socket connection

**Feature 5: Long-Polling Fallback**

- [ ] RED: Write tests for long-polling fallback when WebSockets are unavailable
- [ ] GREEN: Implement multi-transport support in `SocketService`

### 3.2 Real-time Patch Processing (Test-Then-Implement)

**Real-time Update Handling (each feature uses 2-commit TDD cycle):**

**Feature 1: Document Subscription**

- [ ] RED: Write tests for subscribing and unsubscribing to document updates via the socket
- [ ] GREEN: Implement document subscription management

**Feature 2: Incoming Patch Application**

- [ ] RED: Write tests for applying incoming patches to the correct document signals
- [ ] GREEN: Implement real-time patch processing and automatic signal updates

**Feature 3: Sequence Number Validation**

- [ ] RED: Write tests for sequence number validation to ensure patch order
- [ ] GREEN: Implement sequence handling in the patch processor

**Feature 4: Missing Patch Recovery**

- [ ] RED: Write tests for detecting and recovering from missing patches
- [ ] GREEN: Implement a mechanism to fetch missing updates

**Feature 5: Document Staleness**

- [ ] RED: Write tests for detecting if a local document is stale compared to the server
- [ ] GREEN: Implement staleness detection and refetching logic

### 3.3 Conflict Resolution (Test-Then-Implement)

**Conflict Resolution Development (each feature uses 2-commit TDD cycle):**

**Feature 1: Conflict Detection**

- [ ] RED: Write tests for accurately detecting conflicts between local optimistic updates and incoming server patches
- [ ] GREEN: Implement conflict detection logic based on document versions or timestamps

**Feature 2: Optimistic Queue Replay**

- [ ] RED: Write tests for the three-stage reconciliation process (rewind, apply server patch, replay queue)
- [ ] GREEN: Implement the core reconciliation algorithm with optimistic queue replay

**Feature 3: Data Consistency**

- [ ] RED: Write tests to guarantee data consistency after conflict resolution
- [ ] GREEN: Implement data integrity validation checks post-reconciliation

**Feature 4: User Notification**

- [ ] RED: Write tests for notifying the user when a conflict cannot be resolved automatically
- [ ] GREEN: Implement a user-friendly conflict handling and notification system

## Technical Architecture

### Phase 1 Core Services

```
DataFetchLibrary
├── DocumentStore (signals-based document storage)
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
   - **IMPORTANT** Check off the task in README.md
   - CI should fail on this commit
   - Commit message format: `test: add failing tests for [feature]`

2. **GREEN Commit**: `feat: implement [feature name] to pass tests`
   - Write minimal implementation to make all tests pass
   - No additional features beyond what tests require
   - **IMPORTANT** Check off the task in README.md
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

- [ ] `DocumentStore` provides a robust and performant local data cache.
- [ ] Document signals automatically update components in React and Vue.
- [ ] React hooks and Vue composables provide an ergonomic developer experience.
- [ ] Example Todo apps for React and Vue are fully functional for local data management.
- [ ] Memory usage is optimized with signal cleanup.
- [ ] TypeScript provides full type safety.
- [ ] 100% test coverage for all Phase 1 features.
- [ ] No network requests, WebSockets, or real-time features.

### Code Quality Standards

- **100% Test Coverage**: All code must have corresponding tests
- **TypeScript Strict Mode**: Full type safety with no `any` types
- **ESLint Rules**: Enforce consistent code style
- **Performance Budgets**: Memory and timing thresholds
- **Documentation**: JSDoc comments for all public APIs

## Deliverables

**Phase 1:**

- **TypeScript Core Library**: Document store with signals, local action/patch system.
- **React Package**: `useDocument` and `useDocuments` hooks.
- **Vue Package**: Equivalent composables with Vue integration.
- **Example Apps**: Fully functional local-only Todo apps for React and Vue.
- **Test Suite**: Comprehensive test coverage for local-only functionality.
- **Documentation**: API docs and usage examples for local data management.

This restructured plan focuses Phase 1 purely on local-first development and framework integration, leaving all network and real-time features for later phases.
