# Kernel Architecture

`@supergrain/kernel` is organized around a small set of internal layers:

- `core.ts`
  Symbols (`$NODE`, `$PROXY`, `$RAW`, `$VERSION`, `$OWN_KEYS`, `$TRACK`, `$BRAND`), brand types (`Branded<T>`, `Signal<T>`), per-target signal-node storage (`getNodes`, `getNodesIfExist`, `getNode`), and `unwrap`.
- `read.ts`
  The Proxy `get` / `ownKeys` / `has` / `getOwnPropertyDescriptor` traps. Lazy signal allocation per accessed property, ownKeys subscription via `$TRACK`, and the `proxyCache` that pins one proxy per raw target for stable identity. Frozen targets pass through unwrapped. For array methods listed in `array-methods.ts`, `get` returns the raw-array implementation instead of the native method.
- `array-methods.ts`
  `ARRAY_METHODS`: raw-array implementations of the array mutators and whole-array iterators, one table row per method (see the runtime model below).
- `write.ts`
  The Proxy `set` / `deleteProperty` traps via the standalone `setProperty` / `deleteProperty` helpers. Bumps per-property signals only when the value actually changed, plus an array-length signal and a per-target version signal for structural subscribers.
- `store.ts`
  The `createReactive(initial)` factory. Normalizes the root (must be a plain object or array) and wraps it via `createReactiveProxy`.
- `effect.ts` / `disposable.ts`
  Public `effect(fn)` — alien-signals' `effect` whose stop function is also `Disposable` (a `Disposer`), so it works with `using`. `toDisposer` gives stop functions a shared prototype that carries `[Symbol.dispose]`, so the one-per-component stop functions don't each pay for an own property. `makeDisposable` attaches `[Symbol.dispose]` as an own property for husk's resource objects. The `SymbolDisposable` type resolves to `{}` when the consumer's TypeScript `lib` lacks `Symbol.dispose`.
- `batch.ts`
  Public `batch(fn)` — wraps `startBatch`/`endBatch` in try/finally and rejects async callbacks so the depth counter never leaks.
- `profiler.ts`
  Opt-in counters for signal reads, skips, and writes. Zero cost when disabled.
- `internal.ts`
  Subpath entrypoint for sibling Supergrain packages (mill, husk, kernel/react). Exposes the raw write helpers, the un-wrapped `startBatch`/`endBatch`/`getActiveSub`/`setActiveSub` primitives that have footguns the public API hides, and `makeDisposable`.
- `react/`
  The React subpath — `tracked`, `useReactive`, `createStoreContext`, `useComputed`, `useSignalEffect`, `<For>`. Reaches the kernel runtime via the public `@supergrain/kernel` and `@supergrain/kernel/internal` subpaths so the React bundle stays decoupled from kernel's internal layout.

## Runtime model

`createReactive(initial)` returns a reactive Proxy over the root object. Every property read inside an active subscriber (`getActiveSub()` non-null) lazily allocates a per-property signal node and subscribes the active sub to it. Writes through the Proxy go through `setProperty`, which writes the raw value, then notifies the per-property signal (and an array-length signal for arrays, plus a per-target version signal for structural subscribers).

- Reads with no active subscriber short-circuit past signal allocation and return the raw value (the `getActiveSub() == null` skip path).
- Nested objects and arrays are wrapped on demand via `createReactiveProxy`, with `proxyCache` ensuring one proxy per raw target — handle identity stays stable across reads.
- Frozen targets (e.g. `Object.freeze`d documents stored by `@supergrain/silo`) bypass the proxy and return as-is, preserving reference identity for inserted documents.
- Array mutators (`push`, `pop`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`, `shift`, `unshift`) run natively on the raw array, not through the proxy, and then `notifyArrayMutation` fires the signals the change touched (changed indices, plus version/length/own-keys or `$ELEMENTS`) in one batch — synchronous effects don't observe partial states. Calling a native array method with the proxy as `this` would send every element read and write through a trap, which V8 runs roughly 280x slower than the same method on a plain array.
- Whole-array iteration methods (`map`, `forEach`, `filter`, `flatMap`, `reduce`, `reduceRight`) also run on the raw array, handing callbacks reactive elements. A subscriber that iterates subscribes to the array's `length` and `$ELEMENTS` signals once, instead of to every index. Together with the own-keys signal the `get` trap already subscribes to, they change whenever an index signal would: `length` when the array grows or shrinks, `$ELEMENTS` when an element is replaced in place, own-keys when a hole is filled. Early-exit methods (`find`, `some`, `every`, `findIndex`, …) keep the per-index route, since they only subscribe to the indices they visit.

## Signal layer

Signal propagation is delegated to [`alien-signals`](https://github.com/stackblitz/alien-signals). The `signal` / `computed` primitives are re-exported from `@supergrain/kernel` for direct use, and `effect` is re-exported with a `Disposable` stop function; the lower-level `startBatch` / `endBatch` / `getActiveSub` / `setActiveSub` primitives are deliberately not re-exported from the package root because they mutate global state and leak on exception. Use `batch(fn)` instead. Sibling Supergrain packages that need the raw primitives (e.g. for tracking-context manipulation in `tracked()`) import from `@supergrain/kernel/internal`.

## Public API

The `@supergrain/kernel` root exports:

- `createReactive`, `unwrap`, `$BRAND`, `Signal`, `Branded`
- `signal`, `computed` (re-exported from `alien-signals`)
- `effect` (alien-signals' `effect` with a `Disposable` stop function), `Disposer`, `SymbolDisposable`
- `batch`
- `enableProfiling`, `disableProfiling`, `resetProfiler`, `getProfile`, `Profile`
- `getNodesIfExist`, `$TRACK` (used by `tracked()` and other React-side machinery)

The `@supergrain/kernel/react` subpath exports the React bindings; see the package README.

The `@supergrain/kernel/internal` subpath is published but documented as not part of the SemVer contract — it exists to let sibling Supergrain packages reach internal write helpers without re-implementing them.
