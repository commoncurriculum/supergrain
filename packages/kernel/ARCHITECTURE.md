# Kernel Architecture

`@supergrain/kernel` is organized around a small set of internal layers:

- `core.ts`
  Symbols (`$NODE`, `$PROXY`, `$RAW`, `$VERSION`, `$OWN_KEYS`, `$TRACK`, `$BRAND`), brand types (`Branded<T>`, `Signal<T>`), per-target signal-node storage (`getNodes`, `getNodesIfExist`, `getNode`), and `unwrap`.
- `read.ts`
  The Proxy `get` / `ownKeys` / `has` / `getOwnPropertyDescriptor` traps. Lazy signal allocation per accessed property, ownKeys subscription via `$TRACK`, array-mutator batching, and the `proxyCache` that pins one proxy per raw target for stable identity. Frozen targets pass through unwrapped.
- `write.ts`
  The Proxy `set` / `deleteProperty` traps via the standalone `setProperty` / `deleteProperty` helpers. Bumps per-property signals only when the value actually changed, plus an array-length signal and a per-target version signal for structural subscribers.
- `store.ts`
  The `createReactive(initial)` factory. Normalizes the root (must be a plain object or array) and wraps it via `createReactiveProxy`.
- `batch.ts`
  Public `batch(fn)` — wraps `startBatch`/`endBatch` in try/finally and rejects async callbacks so the depth counter never leaks.
- `profiler.ts`
  Opt-in counters for signal reads, skips, and writes. Zero cost when disabled.
- `internal.ts`
  Subpath entrypoint for sibling Supergrain packages (mill, kernel/react). Exposes the raw write helpers and the un-wrapped `startBatch`/`endBatch`/`getCurrentSub`/`setCurrentSub` primitives that have footguns the public API hides.
- `react/`
  The React subpath — `tracked`, `useReactive`, `createStoreContext`, `useComputed`, `useSignalEffect`, `<For>`. Reaches the kernel runtime via the public `@supergrain/kernel` and `@supergrain/kernel/internal` subpaths so the React bundle stays decoupled from kernel's internal layout.

## Runtime model

`createReactive(initial)` returns a reactive Proxy over the root object. Every property read inside an active subscriber (`getCurrentSub()` non-null) lazily allocates a per-property signal node and subscribes the active sub to it. Writes through the Proxy go through `setProperty`, which writes the raw value, then notifies the per-property signal (and an array-length signal for arrays, plus a per-target version signal for structural subscribers).

- Reads with no active subscriber short-circuit past signal allocation and return the raw value (the `getCurrentSub() == null` skip path).
- Nested objects and arrays are wrapped on demand via `createReactiveProxy`, with `proxyCache` ensuring one proxy per raw target — handle identity stays stable across reads.
- Frozen targets (e.g. `Object.freeze`d documents stored by `@supergrain/silo`) bypass the proxy and return as-is, preserving reference identity for inserted documents.
- Array mutators (`push`, `pop`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`, `shift`, `unshift`) are wrapped in `startBatch`/`endBatch` so their internal multi-step writes coalesce into a single notification — synchronous effects don't observe partial states.

## Signal layer

Signal propagation is delegated to [`alien-signals`](https://github.com/stackblitz/alien-signals). The `signal` / `computed` / `effect` primitives are re-exported from `@supergrain/kernel` for direct use; the lower-level `startBatch` / `endBatch` / `getCurrentSub` / `setCurrentSub` primitives are deliberately not re-exported from the package root because they mutate global state and leak on exception. Use `batch(fn)` instead. Sibling Supergrain packages that need the raw primitives (e.g. for tracking-context manipulation in `tracked()`) import from `@supergrain/kernel/internal`.

## Public API

The `@supergrain/kernel` root exports:

- `createReactive`, `unwrap`, `$BRAND`, `Signal`, `Branded`
- `signal`, `computed`, `effect` (re-exported from `alien-signals`)
- `batch`
- `enableProfiling`, `disableProfiling`, `resetProfiler`, `getProfile`, `Profile`
- `getNodesIfExist`, `$TRACK` (used by `tracked()` and other React-side machinery)

The `@supergrain/kernel/react` subpath exports the React bindings; see the package README.

The `@supergrain/kernel/internal` subpath is published but documented as not part of the SemVer contract — it exists to let sibling Supergrain packages reach internal write helpers without re-implementing them.
