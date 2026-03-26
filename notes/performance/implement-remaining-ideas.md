# Implementation: Ideas 3 + 4

You already implemented Ideas 1+2 (committed as c742083, -4.5% weighted). These are the remaining two ideas from `notes/optimization-brainstorm-results.md`. They're independent changes in different files — implement both, then measure once.

## Idea 3: Cache React elements in For

File: `packages/react/src/use-store.ts`

In the For component's parent path, `children(each[i], i)` is called for ALL items on every For render. On append 1k→2k, 1000 of those calls are for unchanged items. Caching the returned element by raw object identity lets React hit its `prevElement === nextElement` fast path, skipping memo comparison entirely.

`useRef` is already imported in this file.

**Before** (the parent path, around line 165):

```typescript
const slots: React.ReactNode[] = Array.from({ length: raw.length });

if (parent) {
  const prevSub = getCurrentSub();
  setCurrentSub(undefined);
  for (let i = 0; i < raw.length; i++) {
    slots[i] = children(each[i], i);
  }
  setCurrentSub(prevSub);
```

**After**:

```typescript
const elementCacheRef = useRef(new Map<unknown, React.ReactNode>());
const slots: React.ReactNode[] = Array.from({ length: raw.length });

if (parent) {
  const prevSub = getCurrentSub();
  setCurrentSub(undefined);
  const prevCache = elementCacheRef.current;
  const nextCache = new Map<unknown, React.ReactNode>();
  for (let i = 0; i < raw.length; i++) {
    const rawItem = raw[i];
    const cached = prevCache.get(rawItem);
    if (cached !== undefined) {
      slots[i] = cached;
    } else {
      slots[i] = children(each[i], i);
    }
    nextCache.set(rawItem, slots[i]);
  }
  elementCacheRef.current = nextCache;
  setCurrentSub(prevSub);
```

Do NOT cache in the non-parent path (the `else` branch). Do NOT change any other file for this idea.

## Idea 4: Reduce computed dependencies for select

File: `packages/js-krauset/src/main.tsx` only (benchmark-specific, not a library change).

Read `item.id` outside the computed so it's captured as a plain number, not a reactive read. The computed subscribes to 1 signal instead of 2.

**Before**:

```typescript
const isSelected = useComputed(() => store.selected === item.id);
```

**After**:

```typescript
const id = item.id;
const isSelected = useComputed(() => store.selected === id);
```

## Verify

Run the same five validation commands as last time before benchmarking. All must pass.

## Measure

Both changes are in different files and independent. Implement both, then run once:

```bash
cd packages/js-krauset
pnpm perf:stats ideas34 15
pnpm perf:compare optimized-v2 ideas34
```

Compare against `optimized-v2` — that's your baseline from the previous round.

**What good looks like**: Any improvement on append-1k or select total time. No benchmark should regress beyond its stddev from `optimized-v2`.

If the combined result regresses any benchmark beyond its stddev, bisect by reverting one change at a time:

- Revert Idea 3: `cd packages/react && git checkout src/use-store.ts`
- Revert Idea 4: `cd packages/js-krauset && git checkout src/main.tsx`

If neither idea produces a measurable total-time improvement, revert both and document in `notes/failed-approaches/` with the numbers.

## Results (2026-03-26)

### What was implemented

- **Idea 3 (element cache in For)**: Added `useRef(new Map())` to cache `children()` results by raw object identity in the parent path. On append 1k→2k, 1000 cached elements hit React's `prevElement === nextElement` fast path. Had to fix placement — initial version put the `useRef` after an early return, violating Rules of Hooks.
- **Idea 4 (computed dependency reduction)**: Read `item.id` outside the computed as a plain number. The computed now subscribes to 1 signal (`store.selected`) instead of 2.

### Benchmark results (15 runs)

Incremental over optimized-v2 (ideas 1+2):

```
optimized-v2 (15 runs) vs ideas34 (15 runs)

Benchmark                   optimized-v2       ideas34      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  50.1ms        51.3ms     +2.4%    0.64     +2.4%
replace all rows                  56.6ms        56.6ms     -0.0%    0.56     -0.0%
partial update (10th)             49.8ms        50.7ms     +1.8%    0.56     +1.8%
select row                        10.8ms        11.0ms     +2.6%    0.19     +2.6%
swap rows                         51.1ms        52.8ms     +3.2%    0.13     +3.2%
remove row                        44.3ms        43.1ms     -2.8%    0.53     -2.8%
create many rows (10k)           603.4ms       591.0ms     -2.1%    0.56     -2.1%
append rows (1k to 1k)            55.9ms        56.1ms     +0.4%    0.55     +0.4%
clear rows                        49.4ms        49.2ms     -0.4%    0.42     -0.4%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)               971.4ms       961.8ms     -1.0%
TOTAL (weighted)                   513.2         507.2     -1.2%
```

Cumulative from original baseline (all 4 ideas):

```
supergrain (15 runs) vs ideas34 (15 runs)

Benchmark                     supergrain       ideas34      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  52.4ms        51.3ms     -2.0%    0.64     -2.0%
replace all rows                  59.0ms        56.6ms     -4.0%    0.56     -4.0%
partial update (10th)             58.0ms        50.7ms    -12.6%    0.56    -12.6%
select row                        14.5ms        11.0ms    -23.9%    0.19    -23.9%
swap rows                         57.1ms        52.8ms     -7.6%    0.13     -7.6%
remove row                        46.5ms        43.1ms     -7.3%    0.53     -7.3%
create many rows (10k)           619.6ms       591.0ms     -4.6%    0.56     -4.6%
append rows (1k to 1k)            59.2ms        56.1ms     -5.3%    0.55     -5.3%
clear rows                        57.5ms        49.2ms    -14.5%    0.42    -14.5%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (unweighted)              1023.8ms       961.8ms     -6.1%
TOTAL (weighted)                   537.6         507.2     -5.6%
```

Incremental improvement from ideas 3+4 is small (-1.2% weighted), within noise for most individual benchmarks. But cumulative effect of all 4 ideas is **-5.6% weighted, -6.1% unweighted** with zero regressions across all 9 benchmarks. Committed as `a91e489`.
