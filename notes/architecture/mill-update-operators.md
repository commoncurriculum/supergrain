# Mill Update Operators: Kernel-Native Mutations

> **Status:** Current. Documents how `@supergrain/mill` applies MongoDB-style
> update operators to reactive stores, why we hand-roll the operators instead
> of using a library like mingo, and the de-hacking pass that routed every
> mutation through the kernel's own write primitives.

## What mill does

`update(store, operations)` applies MongoDB-style operators (`$set`, `$unset`,
`$inc`, `$min`, `$max`, `$push`, `$pull`, `$pullAll`, `$addToSet`, `$rename`) to
a reactive store while preserving fine-grained reactivity — only the signals for
the values that actually changed should fire.

## Decision: we are NOT using mingo (or any external operator library)

We evaluated leaning on [mingo](https://github.com/kofrasa/mingo) (a MongoDB
query/update implementation for plain JS objects) and decided against it:

- **It doesn't drive our signals.** mingo mutates plain objects. Supergrain's
  reactivity comes from the kernel's proxy/signal layer; an external mutator
  would change the underlying data without notifying any signal, so we'd have
  to diff-and-reconcile afterwards (the exact "reconciliation pass" we removed
  for performance). Hand-rolled operators that call the kernel write primitives
  update the right signals inline, with no reconciliation.
- **Surface area / bundle.** We use a small, fixed subset of operators. Pulling
  in a full query engine is bytes and API we don't need.
- **Control.** We want exact, fine-grained signal behavior (e.g. an element
  shift should fire only the moved index, not the whole array). That requires
  owning the mutation loop.

If we ever want broader Mongo compatibility, the path is to add more operators
to `operators.ts` the same way — each calling the kernel primitives — not to
delegate mutation to a library that bypasses the signal layer.

## Decision: mutate the RAW target via kernel write primitives

`update()` unwraps the proxy once (`unwrap(target)`) and applies every operator
to the **raw** object, using the kernel's own write helpers from
`@supergrain/kernel/internal`:

- `setProperty(obj, key, value)` — assigns and fires the property/index signal,
  the length signal, and ownKeys/version as appropriate.
- `deleteProperty(obj, key)` — deletes and fires the index signal (to
  `undefined`), ownKeys, and version.

These are the same functions the proxy's `set`/`deleteProperty` traps call. For
an internal package, calling them directly is the sanctioned "use the kernel"
path — and it is deliberately **not** the same as mutating through the proxy:

- Mutating through the proxy re-reads every path segment via the get trap, so a
  nested `$set` like `posts.all.items.0.title` would incur a signal **read** per
  segment on every update. The kernel's profiler accounting tests
  (`packages/kernel/tests/read/array.test.ts`) pin those read counts and assume
  `update()` adds **zero** navigation reads — operating on the raw object keeps
  that contract.

The whole `update()` body runs inside a single `batch()` (the public, safe
wrapper around `startBatch`/`endBatch`) so every write coalesces into one
notification.

## De-hacking: array removal now uses kernel primitives, not manual signals

The previous `$pull`/`$pullAll` implementation spliced the **raw** array and
then hand-replicated the signal updates the proxy would have made:

- `notifyArrayRemoval()` — manually called `bumpVersion`, `bumpOwnKeysSignal`,
  wrote the `length` signal, and
- `syncIndexedSignals()` — walked the node container and wrote each changed
  per-index signal.

That code re-implemented kernel internals inside mill and required `c8 ignore`
pragmas for branches the kernel guarantees. It's gone. Removal is now an
in-place compaction built entirely from the kernel primitives (`compactArray`):

1. Walk the array; shift each survivor down with `setProperty` (fires only the
   indices whose value actually changed).
2. Remove the vacated tail with `deleteProperty` per index (fires each vacated
   index signal → `undefined` — the value an out-of-bounds `arr[i]` read
   returns — plus ownKeys/version).
3. Truncate with `setProperty(arr, "length", newLength)`.

If nothing matches, the array is left completely untouched (no writes, so
structural subscribers stay silent). `$pullAll` matches by full deep equality
against a list of values and validates that its operand is an array; `$pull`
matches by partial deep equality (`isObjectMatch`).

All `c8 ignore` pragmas were removed: `incrementValue` was rewritten as
`setProperty(parent, key, (typeof current === "number" ? current : 0) + delta)`
(both branches reachable, `assertNumericTarget` guards the rest), and the
`notifyArrayRemoval` ignore disappeared with the function. `operators.ts` and
`path.ts` are at 100% coverage with no ignores.

## Observation: a real gap in the kernel's _proxy_ delete trap

While exploring whether mill could remove elements by splicing the **proxy**
directly, I found a genuine kernel limitation worth recording:

- `writeHandler.deleteProperty` (in `packages/kernel/src/write.ts`) does a
  **silent delete** for array elements — it only bumps `ownKeys`. Its rationale
  is "splice/pop/shift handle element moves via `set()`," which is true for
  _moved_ survivors but **not** for the element at the vacated tail index.
- Consequence: calling `store.items.splice(1, 1)` / `pop()` **directly on the
  proxy** does not notify an effect that subscribed to exactly the removed tail
  index — it reads a stale value until something else invalidates it.
  (Iteration / `length` / `<For>` subscribers are fine, since `ownKeys` fires.)
- The standalone `deleteProperty` helper (used by mill on the raw array) does
  **not** have this gap — it writes the index signal to `undefined`. That's why
  mill's `compactArray` is correct.

This is why mill operates on raw + primitives rather than splicing the proxy.

On the semantics: native array removal (`splice` / `filter`) shortens the array,
so the old tail index becomes out-of-bounds and an `arr[i]` read returns
`undefined`. Notifying the vacated index with `undefined` simply mirrors that —
it is the native-consistent answer, and it matches the kernel's object-delete
path. mill is therefore already native-correct.

The one place still **not** native is the kernel's **proxy** trap: making
`store.items.splice()` fire the vacated index the same way would align the proxy
with native semantics. The blocker is no longer "is `undefined` right" (native
says yes) but performance — it touches the hot delete path the
js-framework-benchmark drives directly (remove/clear), so it must be benchmarked
before changing. Do not change it casually.
