# O(1) swap subscription (`$ELEMENTS` signal) — problem statement and plan

Status: **PLANNED — not yet implemented.** Written 2026-07-27 as a handoff for
the next optimization agent. Read `OPTIMIZATION-AGENT.md` and
`notes/failed-approaches/` before starting; the methodology rules there apply
in full.

## The problem

### The target: create many rows (10k) is script-bound and we're beatable

Official js-framework-benchmark results (2026-07, keyed React implementations,
totals in ms with slowdown factor vs vanillajs):

| Implementation                  | create 1k   | create 10k       | clear       | swap            |
| ------------------------------- | ----------- | ---------------- | ----------- | --------------- |
| vue-vapor (not React)           | 21.2 (1.07) | 226.4 (1.09)     | 8.4 (1.06)  | 11.7 (1.07)     |
| react-hooks                     | 23.6 (1.19) | 424.3 (2.04)     | 16.3 (2.06) | 84.9 (7.79)     |
| react-rxjs                      | 25.6 (1.29) | **361.4 (1.74)** | 17.7 (2.24) | 84.8 (7.78)     |
| react-supergrain (kernel 2.0.1) | 25.5 (1.28) | 413.7 (1.99)     | 16.9 (2.14) | **12.4 (1.14)** |

Two facts frame the problem:

1. At 1k rows, create is paint/layout-bound (browser work ≈ 19.8ms of
   supergrain's 25.5) — the addressable script gap is a couple of ms. At **10k
   rows the ratio inverts: script dominates**, and supergrain's factor is 1.99
   vs vanilla while react-rxjs proves 1.74 is reachable _inside React_. There
   are ~50ms of script on the table at 10k.
2. Supergrain's swap advantage (12.4 vs ~85 for other React implementations)
   comes from `For`'s parent-mode swap effect doing direct DOM moves. That
   advantage is currently **paid for at create time**, which is the subject of
   this plan.

### Where the waste is: per-index subscriptions that exist for no reader

`packages/kernel/src/react/for.ts`, parent mode. On every `For` render, a
layout effect creates an alien-signals effect whose body starts with:

```ts
const nodes = getNodesIfExist(raw);
for (let i = 0; i < raw.length; i++) {
  const node = nodes?.[i];
  if (node) {
    node(); // subscribe to existing per-index signal
  } else {
    void each[i]; // tracked proxy read → getNodes + getNode(i) + link
  }
}
```

On create-10k this loop runs inside the commit and performs **10,000 signal
creations + 10,000 dependency links** (on a fresh array no index signals exist,
so every iteration takes the `void each[i]` path: proxy get trap → `getNodes`
→ `getNode` alloc → link). On clear/replace, tearing the effect down unlinks
those 10,000 edges.

The key structural observation: **in parent mode, nothing else ever subscribes
to per-index array signals.**

- `For`'s render loop deliberately untracks its reads
  (`setActiveSub(undefined)`, for.ts:171-188).
- Row components subscribe to _item property_ signals (`item.label`,
  `item.selected`), not to array indices.
- `App` subscribes to the `data` property signal + the array's `$VERSION`
  (via `trackArrayVersion`), not to indices.
- Benchmark handlers (`update`, `remove`, `swapRows`) read the array outside
  any tracking context.

So the entire per-index signal population exists to answer exactly one
question for exactly one subscriber: _"did some element of this array get
replaced in place?"_ — asked by the swap effect. And the swap effect doesn't
even use the granularity: when it wakes, it ignores _which_ signal fired and
diffs `raw` against its `prevRawRef` snapshot linearly.

Fine-grained subscriptions whose only consumer does a coarse-grained diff are
pure overhead. One signal suffices.

## The proposal

Add a per-array **`$ELEMENTS` signal**: "some element of this array was
replaced in place." Bump it from the write path; have the swap effect
subscribe to that single signal instead of looping every index.

### Kernel: `write.ts`

`setProperty` already computes the exact condition
(`isArrayElementReplace = Array.isArray(target) && hadKey && target.length === prevLen`)
— it's the branch that deliberately _skips_ `bumpVersion` today. Extend it:

```ts
if (didChange) {
  const isArrayElementReplace = Array.isArray(target) && hadKey && target.length === prevLen;
  if (!isArrayElementReplace) {
    bumpVersion(target);
  } else {
    // Coarse "element replaced" notification for subscribers that want to
    // observe in-place element replacement without N per-index subscriptions.
    const nodes = getNodesIfExist(target);
    const elements = nodes?.[$ELEMENTS];
    if (elements) elements(++BUMP);
  }
}
```

Bump ONLY if the signal already exists (i.e., someone subscribed) — arrays
without a parent-mode `For` never allocate it and pay only the
`nodes?.[$ELEMENTS]` load. `$ELEMENTS` is a new symbol in `core.ts`
(`Symbol.for("supergrain:elements")`), exported through `internal.ts` (or via
a small `trackArrayElements(raw)` helper — see below). Do NOT touch the proxy
`get` trap; the fast-push lesson (`notes/failed-approaches/fast-push-bypass-proxy.md`)
says the get handler's shape is untouchable, but `setProperty` is ordinary
code — still, measure every benchmark, not just the targets.

### Kernel react: `for.ts`

Replace the subscription loop in the swap effect body with a single tracked
read:

```ts
const cleanup = alienEffect(() => {
  trackArrayElements(raw); // getNode(getNodes(raw), $ELEMENTS, 0)() — one link
  // ...diff logic unchanged: compare raw vs prevRawRef, fix DOM on 2-change...
});
```

`for.ts` currently imports from `@supergrain/kernel` and
`@supergrain/kernel/internal`; the cleanest seam is a `trackArrayElements`
export from the kernel (mirroring the existing `trackArrayVersion` pattern in
`read.ts`) rather than exporting `getNode`/`getNodes` more broadly.

Non-parent mode (`ForItem`) keeps per-index signals — it genuinely needs
per-index granularity for keyed reconciliation, and its reads create signals
lazily as today. The per-index write path in `setProperty`
(`nodes[key]` signal write) also stays — it's a no-op when no index signals
exist, which after this change is the common case in parent mode.

### Semantics and edge cases

- **Swap:** `swapRows` writes indices 1 and 998 inside `batch()` → two
  `$ELEMENTS` bumps coalesce into one effect run (alien-signals batching) →
  same diff, same 2 DOM moves. Behavior identical to today.
- **Structural changes** (push/splice/length/new array): handled exactly as
  today via `$TRACK`/ownKeys → `For` re-renders → new effect. `$ELEMENTS`
  fires only on the replace-in-place path, which is precisely the path that
  does NOT re-render `For`.
- **>2 elements replaced:** effect wakes once (batched), diff finds >2
  changes, refreshes the snapshot without DOM fixes — the documented existing
  semantics (swap-only repair), unchanged.
- **Teardown:** effect has 1 dep instead of N — cleanup is O(1). Helps clear
  and replace marginally.
- **Snapshot cost unchanged:** `prevRawRef.current = [...raw]` still runs per
  effect creation; that's an O(n) array copy but no allocations-per-element.

## Hypotheses

- **H1 (primary):** create-10k script drops measurably — 10,000
  `getNode`-alloc+link operations leave the commit. From
  `notes/benchmarks/allocation-analysis-benchmark.md` (signal ≈ 18× a plain
  object alloc, ~200 bytes each) expect **single-digit-ms unthrottled, i.e. a
  few % of create-10k script** — this does NOT close the 50ms gap to
  react-rxjs alone; it's the first slice. Also ~2MB less garbage per 10k
  create → less GC inside the window.
- **H2:** create-1k script improves ~1-3% (1,000 fewer alloc+links).
- **H3:** clear/replace improve slightly (O(1) effect teardown instead of
  1,000 unlinks — note this portion overlaps with what PR #135's deferred
  disposal already moved off-path for `tracked()`, but the swap effect's
  teardown is still synchronous in the layout-effect cleanup).
- **H4:** swap stays flat (same wake, same diff, same DOM ops). **If swap
  regresses, the change is dead** — the swap advantage (12.4 vs 85) is worth
  more weighted score than any create gain here.
- **H5:** partial update and remove stay flat (label signals and
  splice/ownKeys paths don't touch `$ELEMENTS`; the new `setProperty` branch
  only executes on element replacement, and remove's splice does hit it for
  shifted elements — watch remove for a regression from 996 `nodes?.[$ELEMENTS]`
  loads + bumps... actually splice shifts ARE element replaces at same length
  during the internal loop. **Check this carefully**: if remove regresses,
  gate the bump on `getNodesIfExist` cheaply or accept one wake of the swap
  effect per splice, which already happens today via per-index signals — net
  should still be neutral-or-better since today splice wakes the effect
  through those same writes.)

## Correctness gates

- `packages/kernel`: `pnpm test` + `pnpm test:react` — especially
  `tests/react/for-component-magic.test.tsx` (swap moves DOM, unmount counts).
- `packages/js-krauset`: `pnpm test` — keyed swap/remove/select tests and the
  profiling-count assertions (partial update: `signalWrites === 100` — the
  `$ELEMENTS` bump must NOT run `profileSignalWrite()`, or this test breaks;
  mirror `bumpVersion`, which is unprofiled).
- Full workspace: all five CLAUDE.md commands.

## Measurement protocol (non-negotiable)

The 2026-07-27 session measured **3-6%/hour drift on identical code** on cloud
VMs (see `notes/failed-approaches/for-passive-swap-effect.md`). Therefore:

1. `pnpm perf:stats pre 15` on the unchanged branch immediately before.
2. Apply the change, `pnpm perf:stats elements 15` immediately after.
3. `pnpm perf:stats post 15` with the change reverted, to bracket drift.
4. Judge on **script medians** (totals are paint-noise on software rendering);
   accept per OPTIMIZATION-AGENT.md thresholds; reject if swap or any
   high-weight benchmark regresses beyond the drift bracket.

## Context: what's already done / rejected

- PR #135 (branch `claude/krauset-row-performance-ys6c4d`): keyed-tbody clear,
  per-item selection (no per-row `computed`), deferred `tracked()` disposal
  queue (`disposal-queue.ts` — reusable here if teardown deferral is wanted).
- Rejected with data: passive swap effect (React passive effects run pre-paint;
  `notes/failed-approaches/for-passive-swap-effect.md`), lazy `$VERSION` +
  WeakMap skip (`notes/failed-approaches/lazy-version-signal-and-weakmap-skip.md`).
- After this experiment, the remaining create-10k levers in rough order of
  expected value: per-Row hook reduction (get `tracked()` to one hook),
  allocation/GC-pressure reduction per row, and refreshing the official
  benchmark submission with the current kernel (the 413.7 was measured on
  kernel 2.0.1 with per-row `useComputed`).
