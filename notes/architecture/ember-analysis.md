# Ember Data Architecture Analysis

> **Status:** Historical reference. Documents the legacy Ember.js data layer being replaced by Supergrain.
> **Purpose:** Capture patterns worth preserving (optimistic updates, conflict resolution, batching) as we build @supergrain/store.

## Architecture Summary

The Ember `store/` folder implements a real-time collaborative data system with:
- Real-time sync via WebSockets (long-polling fallback)
- Offline-first with local caching
- Optimistic updates with server reconciliation
- Conflict resolution and retry
- Action-based state management

## Service Components

### Store Service (`store.ts`)
Central orchestrator. Three-stage action dispatch pipeline:
1. `dispatch()` — validate action exists
2. `dispatchAction()` — assemble with patches/undo/narrative
3. `dispatchPreparedAction()` — persist and apply

Key behaviors:
- **Optimistic queues** track unconfirmed patches per model
- **Server reconciliation**: rewind optimistic changes, apply server changes, replay optimistic changes
- Redux DevTools + Sentry integration

```
Component → store.dispatch(actionName, payload) →
Action Validation → Patch Generation →
Optimistic Application → Server Persistence →
Conflict Resolution (if needed)
```

### MemoryEngine (`memory-engine.ts`)
In-memory document store (`__store__[type][id]`) with patch-based updates and undo/redo.

Supported patch operations: `set`, `unset`, `inc`, `push` (with `$each`), `pull`, `pullAll`, `addToSet`

Key details:
- Each patch application returns a **rewind function** for rollback
- Auto-creates nested paths; deep-clones to prevent cross-patch contamination
- Internal versioning for conflict detection
- FastBoot shoebox integration

### Socket Service (`socket.ts`)
WebSocket connection management with automatic reconnection.

- Falls back from WebSocket to long-polling
- Fibonacci backoff for failed actions
- Auto-disconnect after 15min inactivity; force reload after 24hr stale
- Monitors online/offline status

### Finder Service (`finder.js`)
Batch document fetching.

```
Multiple find() calls → Request Queue →
Batch Grouping (every 15ms) → Adapter Fetch (chunks of 60) →
Document Insertion → Promise Resolution
```

Deduplicates requests. Exponential backoff on failure.

### SocketSubscriber (`socket-subscriber.ts`)
Incoming real-time update handler.

- Sequence number validation (requests missing patches on gaps)
- Revision checking against expected document versions
- 22-second heartbeat ping cycle
- Forces client refresh on version mismatch

## Helper Components

- **FindDoc Resource** — reactive single-doc fetch with loading states (isPending/isFulfilled/isRejected)
- **FindManyAltogether Resource** — batch fetch via `Promise.all()` with array equality checking
- **ActionSummaryProvider** — yields action summary data to components via FindDoc

## Key Patterns Worth Preserving

### Optimistic Updates with Server Reconciliation
1. Apply changes locally (immediate)
2. Send to server async
3. Server detects conflicts via version comparison
4. On conflict: rewind local, apply server, replay local

### Action Structure
```javascript
{
  name: "UPDATE_DOCUMENT",
  patches: [/* MongoDB-style operations */],
  undoPatches: [/* Reverse operations */],
  narrative: /* Human-readable description */
}
```

### Request Batching
- 15ms collection window balances latency vs efficiency
- 60-document chunk limit prevents server overload
- Deduplication avoids redundant fetches

### Resilience Patterns
- Sequence number tracking for ordered patch application
- Missing patch recovery (automatic request on gaps)
- Periodic staleness checks (every 10 minutes)
- Optimistic queue management for unconfirmed changes
- Unsaved work protection before navigation

## External Integrations
Sentry (errors), Redux DevTools (debugging), FullStory (session recording), Amplitude (analytics)
