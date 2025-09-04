# Ember Data Architecture Analysis

This document provides an in-depth analysis of the Ember.js data management system found in the `ember/` folder. The architecture represents a sophisticated real-time data synchronization system with offline support, optimistic updates, and conflict resolution.

## Core Architecture Overview

The system is built around several interconnected services that work together to provide:
- Real-time data synchronization via WebSockets
- Offline-first data storage with local caching
- Optimistic updates with server reconciliation
- Conflict resolution and retry mechanisms
- Action-based state management

## Service Components

### 1. Store Service (`store.ts`)

**Primary Purpose**: Central orchestrator for all data operations, action dispatching, and state management.

**Key Responsibilities**:
- **Action Dispatching**: Validates and dispatches actions through a three-stage pipeline:
  1. `dispatch()` - Validates action exists in codebase
  2. `dispatchAction()` - Assembles action with patches/undo/narrative
  3. `dispatchPreparedAction()` - Handles final preparation and persistence
- **Patch Management**: Applies local changes optimistically and manages server reconciliation
- **Document Staleness Checking**: Periodically validates document freshness (every 10 minutes)
- **Memory Management**: Interfaces with MemoryEngine for in-memory storage

**Key Features**:
- **Optimistic Updates**: Uses optimistic queues to track unconfirmed patches per model
- **Server Reconciliation**: Implements sophisticated conflict resolution by rewinding optimistic changes, applying server changes, then replaying optimistic changes
- **Redux DevTools Integration**: Supports debugging through Redux DevTools extension
- **Sentry Integration**: Comprehensive error tracking and breadcrumb logging

**Data Flow**:
```
Component → store.dispatch(actionName, payload) →
Action Validation → Patch Generation →
Optimistic Application → Server Persistence →
Conflict Resolution (if needed)
```

### 2. MemoryEngine Service (`memory-engine.ts`)

**Primary Purpose**: Local in-memory data store with patch-based updates and undo/redo functionality.

**Key Responsibilities**:
- **Document Storage**: Maintains type-organized document storage (`__store__[type][id]`)
- **Patch Application**: Applies MongoDB-style operations (set, unset, inc, push, pull, etc.)
- **Undo/Redo**: Maintains history stacks for state rollback
- **FastBoot Integration**: Synchronizes with server-side rendering shoebox

**Patch Operations Supported**:
- `set`: Direct property assignment
- `unset`: Property removal
- `inc`: Numeric increment
- `push`: Array element addition (with `$each` support)
- `pull`: Array element removal with pattern matching
- `pullAll`: Multiple element removal
- `addToSet`: Unique array element addition

**Key Features**:
- **Rewind Functions**: Each patch application returns a rewind function for rollback
- **Path Ensuring**: Automatically creates nested object paths as needed
- **Deep Cloning**: Prevents cross-patch data contamination
- **Internal Versioning**: Tracks local change versions for conflict detection

### 3. Socket Service (`socket.ts`)

**Primary Purpose**: Real-time WebSocket communication with fallback to long-polling.

**Key Responsibilities**:
- **Connection Management**: Handles WebSocket connections with automatic reconnection
- **Action Publishing**: Sends local actions to server with retry logic
- **Model Subscriptions**: Manages real-time subscriptions to specific documents
- **Activity Tracking**: Monitors user activity for connection lifecycle management
- **Transport Switching**: Falls back from WebSocket to long-polling when needed

**Connection Lifecycle**:
- **Active Start**: Connects when user becomes active
- **Active End**: Tracks session duration and reports analytics
- **Auto-Disconnect**: Closes connections after 15 minutes of inactivity
- **Reconnection**: Automatically reconnects with exponential backoff

**Error Handling**:
- **Fatal Errors**: Shows user-friendly error dialogs for server conflicts
- **Retry Logic**: Implements Fibonacci backoff for failed actions
- **Network Detection**: Monitors online/offline status
- **Stale Detection**: Forces page reload after 24 hours of inactivity

### 4. Finder Service (`finder.js`)

**Primary Purpose**: Efficient batch fetching of documents from the server.

**Key Responsibilities**:
- **Request Queuing**: Collects individual find requests into batches
- **Batch Processing**: Groups requests by model type and fetches in chunks of 60
- **Deduplication**: Prevents duplicate requests for the same document
- **Promise Management**: Manages promise resolution for queued requests
- **FastBoot Integration**: Defers rendering until critical data is loaded

**Request Flow**:
```
Multiple find() calls → Request Queue →
Batch Grouping (every 15ms) → Adapter Fetch →
Document Insertion → Promise Resolution
```

**Performance Features**:
- **Request Batching**: Reduces HTTP requests by batching
- **Duplicate Detection**: Avoids redundant server requests
- **Chunking**: Limits batch size to prevent server overload
- **Retry Logic**: Handles failures with exponential backoff

### 5. SocketSubscriber Service (`socket-subscriber.ts`)

**Primary Purpose**: Handles incoming real-time updates and maintains data consistency.

**Key Responsibilities**:
- **Patch Processing**: Processes incoming patches with sequence number validation
- **Heartbeat Management**: Maintains connection health with server pings
- **Version Checking**: Ensures client version compatibility
- **Sequence Management**: Handles out-of-order patch delivery

**Patch Processing Logic**:
1. **Sequence Validation**: Ensures patches arrive in order
2. **Revision Checking**: Validates document versions match expected state
3. **Missing Patch Detection**: Requests missing patches when gaps detected
4. **Server Reconciliation**: Applies patches using conflict resolution strategy

**Key Features**:
- **Lost Sequence Recovery**: Automatically requests missing patches
- **Version Compatibility**: Forces refresh when client version is outdated
- **Heartbeat Loop**: 22-second ping cycle for connection health
- **Automatic Updates**: Triggers staleness checks after reconnection

## Helper Components

### 6. FindDoc Resource (`find-doc.ts`)

**Purpose**: Ember Resource for reactive document fetching with loading states.

**Features**:
- **Reactive Updates**: Automatically refetches when arguments change
- **Loading States**: Provides isPending, isFulfilled, isRejected states
- **Force Refresh**: Supports bypassing cache when needed

### 7. FindManyAltogether Resource (`find-many-altogether.ts`)

**Purpose**: Batch fetching multiple documents of the same type.

**Features**:
- **Batch Operations**: Uses `Promise.all()` for concurrent fetching
- **Array Management**: Handles array equality checking for updates
- **Type Safety**: Maintains TypeScript type safety across operations

### 8. ActionSummaryProvider Component (`action-summary-provider.ts`)

**Purpose**: Provides action summary data to components.

**Features**:
- **Resource Integration**: Uses FindDoc resource for data fetching
- **Component Yielding**: Yields loaded data to component blocks

## Data Synchronization Strategy

### Optimistic Updates with Server Reconciliation

The system implements a sophisticated optimistic update strategy:

1. **Local Application**: Changes are applied immediately to local state
2. **Server Transmission**: Actions are sent to server asynchronously
3. **Conflict Detection**: Server compares expected vs actual document versions
4. **Reconciliation**: On conflicts, local changes are rewound, server changes applied, then local changes replayed

### Action-Based Architecture

All state changes flow through actions:

```javascript
// Action Structure
{
  name: "UPDATE_DOCUMENT",
  patches: [/* MongoDB-style operations */],
  undoPatches: [/* Reverse operations */],
  narrative: /* Human-readable description */
}
```

### Real-Time Synchronization

- **WebSocket Primary**: Real-time bidirectional communication
- **Long-Polling Fallback**: Ensures connectivity in restrictive networks
- **Subscription Management**: Components subscribe to specific documents
- **Automatic Recovery**: Handles connection drops and patch gaps

## Key Design Patterns

### 1. Service Layer Architecture
- Clear separation between data (MemoryEngine), networking (Socket), and coordination (Store)
- Dependency injection through Ember's service system
- Event-driven communication between services

### 2. Optimistic UI Pattern
- Immediate local updates for responsive UI
- Background server synchronization
- Conflict resolution without user disruption

### 3. Patch-Based Updates
- Granular change tracking
- Efficient network usage
- Enables undo/redo functionality
- Supports collaborative editing

### 4. Resource Pattern (Ember Resources)
- Reactive data fetching
- Automatic cleanup
- Loading state management
- Argument change detection

## Error Handling & Resilience

### Network Resilience
- **Connection Monitoring**: Tracks online/offline status
- **Automatic Reconnection**: Exponential backoff retry strategy
- **Transport Fallback**: WebSocket to long-polling degradation
- **Activity-Based Management**: Closes unused connections to preserve resources

### Data Consistency
- **Sequence Number Tracking**: Ensures ordered patch application
- **Missing Patch Recovery**: Automatically requests missing updates
- **Staleness Detection**: Periodic validation of document freshness
- **Optimistic Queue Management**: Tracks and reconciles unconfirmed changes

### User Experience
- **Fatal Error Handling**: User-friendly error dialogs with page reload
- **Sync Status Indicators**: Visual feedback for synchronization state
- **Unsaved Work Protection**: Warns users before losing unsynced changes
- **Version Management**: Automatic updates when new client versions available

## Performance Optimizations

### Request Batching
- **Finder Batching**: Groups individual requests into efficient batches
- **15ms Collection Window**: Optimal balance between latency and efficiency
- **60-Document Chunks**: Prevents server overload

### Memory Management
- **Document Caching**: In-memory storage with FastBoot shoebox integration
- **Optimistic Queue Cleanup**: Removes confirmed changes from memory
- **Connection Lifecycle**: Closes inactive connections after 15 minutes

### Network Optimization
- **Subscription Management**: Only receives updates for viewed documents
- **Patch Filtering**: Excludes non-essential patches from network transmission
- **Compression**: Efficient serialization of action and patch data

## Integration Points

### Ember.js Integration
- **Service System**: Uses Ember's dependency injection
- **Run Loop**: Coordinates with Ember's rendering cycle
- **FastBoot Support**: Server-side rendering compatibility
- **Component Integration**: Resources integrate with Ember components

### External Services
- **Sentry**: Error tracking and performance monitoring
- **Redux DevTools**: Development debugging support
- **FullStory**: User session recording integration
- **Amplitude**: Analytics event tracking

## Conclusion

This architecture represents a production-grade, real-time collaborative application framework with sophisticated conflict resolution, offline support, and performance optimizations. The system successfully handles the complexities of distributed state management while maintaining a responsive user experience.

The key innovations include:
- Server reconciliation for conflict-free collaborative editing
- Optimistic updates with automatic rollback/replay
- Intelligent connection management based on user activity
- Comprehensive error recovery and resilience patterns

This would serve as an excellent foundation for building similar real-time collaborative applications requiring strong consistency guarantees and offline-first capabilities.
