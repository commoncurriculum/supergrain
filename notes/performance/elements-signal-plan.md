# create-10k optimization plan — problem statement and design candidates

Status: **PLANNED — not yet implemented.** Written 2026-07-27 as a handoff for
the next optimization agent. Read `OPTIMIZATION-AGENT.md` and
`notes/failed-approaches/` before starting; the methodology rules there apply
in full. This doc contains one problem statement and **six design candidates
(D0–D5)** — each is its own experiment under the one-change-per-experiment
rule. D1 is the primary bet; D0 should run first because it is evidence, not
code.

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

Three facts frame the problem:

1. At 1k rows, create is paint/layout-bound (browser work ≈ 19.8ms of
   supergrain's 25.5) — the addressable script gap is a couple of ms. At **10k
   rows the ratio inverts: script dominates**, and supergrain's factor is 1.99
   vs vanilla while react-rxjs proves 1.74 is reachable _inside React_. There
   are ~50ms of script on the table at 10k.
2. Supergrain's swap advantage (12.4 vs ~85 for other React implementations)
   comes from `For`'s parent-mode swap effect doing direct DOM moves. That
   advantage is currently **paid for at create/append time** (per-index
   subscriptions) and at clear time (their teardown).
3. The official 413.7 was measured on kernel 2.0.1 with the old app (per-row
   `useComputed`). PR #135 already removed the per-row computed and deferred
   `tracked()` teardown — the published numbers are stale (see D5).

### Supergrain's per-row cost inventory at create (what a row buys today)

For each of 10,000 rows, mount pays: one `memo(Tracked)` fiber, a
`useReducer` and a `useEffect` (disposal) hook, one alien-signals effect
(alloc, first run, 2 context switches), one item proxy (with `$PROXY`
defineProperty and a WeakMap write), one `$NODE` object, the
`$VERSION`/`label`/`selected` signals and their links, and one per-index
array signal linked by the `For` swap effect. react-hooks pays none of this;
react-rxjs pays a per-row subscription but is still 52ms faster than
supergrain at 10k. The designs below each remove a slice.

### The biggest single slice: per-index subscriptions that exist for no reader

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
creations + 10,000 dependency links** (fresh array → every iteration takes the
`void each[i]` path: proxy get trap → `getNodes` → `getNode` alloc → link).
On clear/replace, teardown unlinks those 10,000 edges. On append, the
dep-less effect re-creation unsubscribes 1,000 and resubscribes 2,000.

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

---

## D0 — Attribution study: where do react-rxjs's 52ms come from? (run FIRST)

**Hypothesis:** the 50ms gap decomposes into a few nameable slices (hook
count, alien effect creation, proxy+signal allocation, per-index
subscriptions, GC), and knowing the split ranks D1–D4 by expected value
instead of guessing.

**Method:** no code changes. (1) Read react-rxjs's implementation in the
js-framework-benchmark repo — what does it allocate per row? does it use one
subscription per row or per list? memo? how many hooks? (2) Run
`pnpm perf:profile` / `pnpm perf:analyze create-10k` on the current branch and
attribute self-time to: React mount (`completeUnitOfWork`, `beginWork`,
hooks), kernel (`get`, `getNodes`, `getNode`, `link`, `effect`), and GC.
(3) Write the split into this doc before choosing the next experiment.

**Verdict criteria:** none — this is evidence gathering. Budget ~30 min.

### D0 findings (2026-07-27, session VM)

**react-rxjs's per-row cost is zero.** Its row is a plain `React.memo`
component with no hooks and no per-row subscription; the entire app holds two
list-level `useStateObservable` subscriptions (rows array + selected id) in
one `RowList` component. All mutations produce new arrays (`slice()` +
in-place edit), so rows are plain objects with no proxies or signals. Its
create-10k therefore pays only: 10k memo fibers + DOM. Everything supergrain
adds on top of that (per-row `useReducer` + disposal `useEffect`, alien
effect alloc + 2 context switches, item proxy + `$NODE` + `$PROXY`
defineProperty + WeakMap write, `label`/`selected`/`$VERSION` signals,
per-index signal + link from the swap effect) IS the 52ms gap — there is no
single hot function to attribute it to.

**Profile attribution (create-10k, `pnpm perf:analyze`, profiling overhead
included — do not read as timings):** of 3726ms profiled, ~900ms is
Playwright's selector engine (`matches`/`query` — measurement harness, not
app), ~50% is unattributed `(program)`. App-side, React DOM commit dominates:
`getHostSibling` 255ms (6.9% — React's sibling walk when placing 10k new
rows into an existing tbody), `appendChild` 70ms, `setProp`/`setTextContent`
~52ms, fiber creation + completeWork ~39ms. Kernel functions are nearly
invisible in self-time: proxy `get` 10.5ms, `signal` 7.4ms, `useReducer`
4.9ms. GC: 93ms in-window. Conclusion: the kernel's per-row cost hides in
allocation volume/GC and in unattributed inlined code, not in a nameable hot
function — consistent with D1 (remove 10k signal allocs + links) and D4
(allocation diet) being the right levers, and with D3 attacking the React
commit/passive-unmount side.

---

## D1 — `$ELEMENTS`: one array-level signal instead of N per-index subscriptions (primary bet)

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
(`Symbol.for("supergrain:elements")`). Do NOT touch the proxy `get` trap
(`notes/failed-approaches/fast-push-bypass-proxy.md`); `setProperty` is
ordinary code — still, measure every benchmark, not just the targets. The
bump must NOT call `profileSignalWrite()` (mirror `bumpVersion`) or
js-krauset's `signalWrites === 100` assertion breaks.

### Kernel react: `for.ts`

Replace the subscription loop in the swap effect body with a single tracked
read via a new kernel export mirroring the `trackArrayVersion` pattern:

```ts
const cleanup = alienEffect(() => {
  trackArrayElements(raw); // getNode(getNodes(raw), $ELEMENTS, 0)() — one link
  // ...diff logic unchanged: compare raw vs prevRawRef, fix DOM on 2-change...
});
```

Non-parent mode (`ForItem`) keeps per-index signals — it genuinely needs
per-index granularity for keyed reconciliation. The per-index write in
`setProperty` (`nodes[key]` signal write) also stays — it's a no-op when no
index signals exist, which after this change is the common case in parent
mode.

### Semantics and edge cases

- **Swap:** two writes inside `batch()` → bumps coalesce → one effect run →
  same diff, same 2 DOM moves. Identical behavior.
- **Structural changes** (push/splice/length/new array): handled as today via
  `$TRACK`/ownKeys → `For` re-renders → new effect. `$ELEMENTS` fires only on
  the replace-in-place path, which is precisely the path that does NOT
  re-render `For`.
- **>2 elements replaced:** effect wakes once, diff finds >2 changes,
  refreshes the snapshot without DOM fixes — existing documented semantics.
- **Teardown:** 1 dep instead of N — O(1) cleanup.
- **Splice caution:** splice's internal element shifts ARE same-length
  replaces mid-loop and will bump `$ELEMENTS` (batched by the ARRAY_MUTATORS
  wrapper). Today those same writes wake the effect through per-index
  signals, so net wake count is unchanged — but verify remove doesn't move.

### Hypotheses

- **H1:** create-10k script drops — 10,000 `getNode`-alloc+link ops leave the
  commit. From `notes/benchmarks/allocation-analysis-benchmark.md` (signal ≈
  18× a plain-object alloc, ~200 bytes) expect **single-digit ms unthrottled
  (a few % of create-10k script)** plus ~2MB less garbage per create → less
  GC in-window. This is the first slice, not the whole 50ms.
- **H2:** create-1k script improves 1-3%.
- **H3:** clear/replace improve slightly (O(1) teardown).
- **H4:** swap stays flat. **If swap regresses, the change is dead** — the
  swap advantage is worth more weighted score than any create gain here.
- **H5:** partial update flat; watch remove (splice bumps, see above).

### D1 verdict: ACCEPTED (2026-07-27, session VM) — with a measurement story worth reading

Implemented exactly as designed (commit `6b69416`, lint fix `bfdbf3d`). All
correctness gates pass: 151 kernel unit tests, 87 React browser tests
(including every parent-mode swap/interleaving case in
`for-component-magic.test.tsx` and StrictMode), 10 js-krauset dist tests
(keyed swap/remove/select, `signalWrites === 100`, `rowRenderCount === 2`).

**Script medians, full pre/change/post bracket (15 runs each):**

| benchmark (script median) | pre    | d1     | post (reverted) | d1b (clean rerun) |
| ------------------------- | ------ | ------ | --------------- | ----------------- |
| create 10k                | 727.30 | 601.62 | 711.59          | 574.66            |
| create 1k                 | 25.55  | 31.03  | 24.71           | 32.03             |
| swap                      | 2.71   | 3.09   | 2.82            | 3.41              |
| clear                     | 80.57  | 79.68  | 77.86           | 79.98             |

**Interleaved A/B (12 pairs, alternating kernel dist within one time window
— eliminates the 3-6%/hr VM drift):** create-10k **−20.8% median**; swap
−8.7%; clear −5.1%; remove −5.2%; replace −4.4%; append −1.1%; partial
update −4.4%; but create-1k **+36% median (10/12 pairs positive)**.

**The create-1k anomaly is GC aliasing, not script cost.** Three lines of
evidence: (1) replace-all — the same 1,000-row creation but starting with
rows present — _improved_, so the per-row work didn't get slower; (2) the
regression is bimodal, with script AND paint inflating together (a
GC-pause fingerprint, not added work — D1 produces byte-identical DOM);
(3) decisively, re-running the interleave with a forced full GC before each
timed click (`PROFILE=1` calls `HeapProfiler.collectGarbage` pre-trace):
base median 46.10 vs d1 44.84 (15 pairs, deltas centered on zero, 6/15
positive — a coin flip; absolute numbers inflated by profiler overhead,
symmetrically). Mechanism: D1 removes ~200KB of signal allocations per
create cycle, which shifts when V8's scavenge threshold is crossed relative
to the measured window — on this VM that lands a GC inside create-1k's
window more often. H1 was right about the win but wrong about the size
(−15-21%, not single-digit ms); H4 holds (swap improved); H2's create-1k
prediction was neutral-not-better once the artifact is controlled.

**Caveat for D5 (official submission):** validate create-1k on the official
harness (bare metal, hardware rendering, different GC cadence) before
publishing. If it regresses there too, it is still aliasing — but the
scoreboard doesn't care; consider whether the 10k win justifies it (weighted
total on this VM: −5.3%).

---

## D2 — Reuse the swap effect across same-array renders (`deps: [raw, parent]`) — composes with D1

**Problem slice:** the swap effect is deliberately dep-less ("must re-create
… so it captures the latest `raw`", for.ts:85-87), so **every** `For`
re-render tears down and re-creates it. On append that's 1,000 unsubscribes +
2,000 resubscribes inside the commit (the bulk of the +3.7ms append gap vs
react-hooks measured in `notes/optimization-brainstorm-results.md`); on
remove it's ~2,000 graph ops for a 1-row change.

**Design:** give the effect a deps array `[raw, parent]` so it is re-created
only when the array **reference** changes (create/replace/clear), not when the
same array mutates structurally (append/remove).

**Why this is only safe after D1:** today the effect's subscriptions are
per-index snapshots of `raw.length` at creation time — after an append,
indices ≥ old length would have no subscription and a swap touching them
would be missed. With D1 the subscription is array-level, so one `$ELEMENTS`
link covers all future indices; the effect body already reads `raw.length`
dynamically.

**Required detail:** when `For` re-renders without re-creating the effect
(append/remove), `prevRawRef` must still be refreshed to the new contents —
otherwise the next wake sees a length mismatch mid-swap and skips the DOM
fix. Refresh the snapshot in the render path (or effect-body length guard +
snapshot, as today — but then a swap immediately after an append is missed;
prefer the render-path refresh and test exactly this interleaving:
append → swap → assert DOM).

**Hypotheses:** append script improves measurably (the whole re-subscription
churn disappears); remove improves slightly; create/clear unchanged; swap
unchanged. Risk: React runs dep-less cleanup differently from deps-mismatch
cleanup — StrictMode double-invoke behavior must be re-tested
(`tracked-strict-mode.test.tsx`, `for-component-magic.test.tsx`).

---

## D3 — Kill the per-row passive unmount effect (ref-cleanup disposal)

**Problem slice:** every `tracked()` component carries a `useEffect` whose
only job is teardown scheduling. On clear, React's passive-unmount machinery
(`commitPassiveUnmountEffectsInsideOfDeletedTree`,
`recursivelyTraversePassiveUnmountEffects`) traverses 10k+ fibers because
those effect flags exist — profiled at ~27ms + ~3ms across the 6 clears of a
profile session on the session VM, and the 1.5ms supergrain-vs-react-hooks
clear delta in `notes/optimization-brainstorm-results.md` is exactly this.
With PR #135 the _work inside_ each destroy is already a cheap enqueue; the
remaining cost is the traversal + hook bookkeeping itself.

**Design:** React 19 supports **cleanup functions returned from host refs**.
A ref callback on the component's host element can register the alien-effect
disposal: attach = no-op, detach cleanup = `scheduleDisposal(...)`. Ref
cleanups run during the mutation phase (sync) but the body is one queue push.
This removes the `useEffect` from `tracked()` entirely → one hook per row
(`useReducer`) and no passive-effect flags on row fibers → the passive
deletion traversal exits early at the subtree-flag check.

**Two integration options, in order of preference:**

1. **Library-level, opt-in:** `tracked(Component, { refDisposal: true })` or a
   `useTrackedRef()` hook the component spreads onto its host root
   (`<tr ref={trackedRef}>`). Generic `tracked()` can't assume a host root
   exists, so this cannot be the unconditional default.
2. **App-level:** js-krauset's `Row` wires it manually.

**Hypotheses:** clear script improves (traversal shrinks); create improves
(one fewer hook mount × 10k — the hook-reduction history in
`notes/performance/implement-hook-reduction.md` measured −14% clear / −4%
create from removing 2 hooks, so removing 1 more is plausibly half that).
Risks: StrictMode ref double-invoke semantics; refs detach on every
re-parenting; dev-mode `useDisposeOnUnmount` timer dance must be preserved or
replicated. This is the most invasive design — do it after D1/D2 prove out.

---

## D4 — Allocation diet in `tracked()` (GC pressure at 10k)

**Problem slice:** create-10k allocates per row: the `TrackedState` wrapper
object (`{cleanup, effectNode}`), the alien effect node + its closure, the
`capturedNode` dance closure, plus kernel-side `$NODE` object and 2-3
signals. The session VM showed ~15ms GC on create-1k profiles; at 10k GC
lands inside the measured window.

**Design (measure as one experiment, it's all mount-path):**

- Store `cleanup`/`effectNode` as two flat properties on the dispatch
  function instead of one wrapper object (saves 1 alloc + 1 indirection per
  row).
- Have the tracked effect's first-run closure capture nothing but the node
  (drop the `firstRun` boolean by using `alienEffect`'s return-order
  guarantees, if possible without changing behavior).
- In js-krauset `Row`, hoist the two `onClick` arrow closures into
  memoized-per-item handlers only if profiling shows them (they may be
  jit-cheap; don't fight React idiom blindly).

**Hypotheses:** create-10k script/GC improves 1-3%; everything else flat.
Watch for the `tracked-state-reduce-closures.md` trap: this exact family
measured as pure thermal noise once before — bracket with pre/post baselines
(protocol below) and reject anything inside the bracket.

---

## D5 — Refresh the official submission (mechanical, guaranteed)

The official table's 413.7/16.9/6.1 for supergrain is kernel **2.0.1** with
per-row `useComputed` selection. PR #135's app + kernel changes measured
(session VM, script medians vs adjacent baseline): select −42%, create-1k
−10%, clear −9.5%, partial update −7.7%. Publish the kernel, bump the
benchmark repo's `add-supergrain` branch per the CLAUDE.md submission
checklist (published versions, no vite alias, `customURL`), and re-run their
harness locally to confirm before submitting. This is the only design with a
guaranteed payoff and it compounds with everything above.

---

## Already rejected — do not re-tread (see `notes/failed-approaches/`)

- **Passive swap effect / deferring work into React's passive phase** — React
  flushes passive effects pre-paint; nothing leaves the measured window
  (`for-passive-swap-effect.md`). Post-paint deferral works ONLY via
  rAF→setTimeout (that's what the disposal queue does).
- **Lazy `$VERSION` + WeakMap-write skip** — no create win, partial-update
  regression from write-path polymorphism
  (`lazy-version-signal-and-weakmap-skip.md`).
- Everything in the OPTIMIZATION-AGENT.md failed-approaches digest: get-trap
  shape changes, readSignal compilation, eager signal preallocation, signal
  pooling, WeakMap node storage, USSE-as-tried, direct-DOM (no SSR).

## Correctness gates (every design)

- `packages/kernel`: `pnpm test` + `pnpm test:react` — especially
  `tests/react/for-component-magic.test.tsx` (swap moves DOM, unmount counts)
  and `tracked-strict-mode.test.tsx`.
- `packages/js-krauset`: `pnpm test` — keyed swap/remove/select tests and the
  profiling-count assertions (partial update `signalWrites === 100`, select
  `rowRenderCount === 2`).
- Full workspace: all five CLAUDE.md commands.

## Measurement protocol (non-negotiable)

The 2026-07-27 session measured **3-6%/hour drift on identical code** on cloud
VMs (see `notes/failed-approaches/for-passive-swap-effect.md`). Therefore, per
experiment:

1. `pnpm perf:stats pre 15` on the unchanged branch immediately before.
2. Apply ONE design, `pnpm perf:stats <design> 15` immediately after.
3. `pnpm perf:stats post 15` with the change reverted, to bracket drift.
4. Judge on **script medians** (totals are paint-noise on software
   rendering); accept per OPTIMIZATION-AGENT.md thresholds; reject anything
   inside the drift bracket; combine accepted designs and re-measure the
   combination.

## Context: current branch state

PR #135 (branch `claude/krauset-row-performance-ys6c4d`): keyed-tbody clear,
per-item selection (no per-row `computed`), deferred `tracked()` disposal
queue (`packages/kernel/src/react/disposal-queue.ts` — reusable by D2/D3).
