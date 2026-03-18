# Valtio Comparison

> **Status:** Reference analysis. Valtio is the most architecturally similar competitor -- both use JavaScript Proxy for reactive state.
>
> **Key difference:** Valtio uses direct mutation + snapshot immutability for React; Supergrain uses proxy-based signal tracking with `tracked()`. Valtio has faster reads via snapshots; Supergrain has faster updates via in-place mutations.

## Architecture

| Aspect               | Valtio                                 | Supergrain                              |
| -------------------- | -------------------------------------- | --------------------------------------- |
| Proxy Creation       | Manual via `proxy()`                   | Automatic in `createStore()`            |
| React Integration    | `useSnapshot` + `useSyncExternalStore` | `tracked()` with per-component proxy    |
| Fine-grained Updates | `proxy-compare` library                | alien-signals                           |
| Memory Model         | Proxy + immutable snapshots            | Single reactive proxy with signal nodes |
| Nested Objects       | Auto-proxied on mutation               | Auto-proxied via `wrap()`               |
| State Mutation       | Direct mutation allowed                | Direct mutation or operators            |

### React Integration Detail

Valtio's `useSnapshot` creates an immutable snapshot and wraps it in a tracking proxy (via `proxy-compare`) to detect which properties were accessed during render. This means reads go through plain frozen objects (fast) but snapshot creation adds overhead per update.

Supergrain's `tracked()` (formerly `useTracked`) wraps the store in a proxy that swaps the active subscriber during each property access, providing per-component isolation without snapshot creation.

## Memory Comparison

| Nesting Level | Valtio     | Supergrain | Difference      |
| ------------- | ---------- | ---------- | --------------- |
| 1 level       | ~150 bytes | ~200 bytes | Supergrain +33% |
| 3 levels      | ~450 bytes | ~600 bytes | Supergrain +33% |
| 6 levels      | ~870 bytes | ~1.2KB     | Supergrain +38% |
| 10 levels     | ~1.45KB    | ~2.0KB     | Supergrain +38% |

Valtio also maintains snapshot caches (`snapCache` WeakMap), proxy state maps, and ref sets.

## Performance Comparison

| Operation          | Valtio       | Supergrain | Notes                   |
| ------------------ | ------------ | ---------- | ----------------------- |
| Store creation     | ~2-5ms       | ~1.3ms     | Both use lazy proxying  |
| Direct proxy reads | ~0.02ms      | ~0.08ms    | Valtio ~4x faster       |
| Snapshot reads     | ~0.016ms     | N/A        | Frozen plain objects    |
| Deep proxy reads   | ~0.08-0.11ms | ~0.13ms    | Similar                 |
| Shallow updates    | ~1.5-10ms    | ~0.5ms     | Supergrain 3-20x faster |
| Deep updates       | ~7-15ms      | ~1.0ms     | Supergrain 7-15x faster |

Valtio's update overhead is dominated by snapshot regeneration, which must traverse the entire state structure. Without automatic batching, multiple mutations trigger multiple expensive snapshot cycles.

## Key Differences

**Valtio advantages:**

- Direct mutation API (natural syntax)
- Fast snapshot reads (frozen plain objects)
- Snapshot immutability useful for debugging
- No explicit update function needed

**Valtio disadvantages:**

- Expensive snapshot generation per update
- No automatic batching (multiple mutations = multiple snapshots)
- Relies on external `proxy-compare` for tracking
- Higher update overhead for deep structures

**Supergrain advantages:**

- Much faster updates (in-place, no snapshot generation)
- Automatic batching
- MongoDB-style operators for complex updates
- Self-contained (no external comparison library)
- Lower per-update memory allocation

**Supergrain disadvantages:**

- Slower reads (proxy traps vs frozen objects)
- Slightly higher per-object memory (~33-38% more)

## When to Choose Valtio

- Read-heavy workloads with infrequent updates
- Teams preferring direct mutation without update functions
- Need for snapshot immutability (debugging, undo/redo)
- Relatively flat state structures

## When to Choose Supergrain

- Write-heavy workloads with frequent updates
- Deep nested state structures
- Need for complex update operators
- Automatic batching is important
