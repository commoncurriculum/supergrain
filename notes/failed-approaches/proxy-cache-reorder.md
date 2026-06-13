# FAILED: Proxy Cache Reorder + trackArrayVersion Dedup

> **Status:** FAILED — flat (within noise), reverted
> **Date:** June 2026
> **TL;DR:** Reordering `createReactiveProxy` to check the `$PROXY` cache before
> the `instanceof Map`/`instanceof Set` branches (to save two `instanceof`
> checks on the hottest read path), plus removing a provably-redundant
> `getActiveSub()` in `trackArrayVersion`, measured flat. The apparent +2–7%
> read-path gains were artifacts of outlier samples in the baseline runs, not a
> real effect. Same conclusion as every other store-internals micro-opt: V8
> already handles these checks cheaply, so removing them doesn't move the needle.

## Origin

Came out of an analysis of whether [compilecat](https://github.com/isaac-mason/compilecat)'s
transforms (`@inline`/`@flatten`/`@sroa`/`@unroll`) apply to the kernel. They
don't — compilecat targets numeric/tuple hot loops (vec3/quat/matrix), and its
one applicable transform (`@inline`) was already disproven here (see
[Inline Primitive Checks](inline-primitive-checks-optimization.md)). But the
read-path review surfaced two "remove redundant work" candidates worth testing.

## What Was Tried

### Change 1: `$PROXY` cache check before Map/Set dispatch (`read.ts`)

For an already-wrapped plain object — the hottest read path — `createReactiveProxy`
ran two `instanceof` checks before reaching the cache hit.

```ts
// Before
if (target[$RAW]) return target;
if (target instanceof Map) return createReactiveMap(target);
if (target instanceof Set) return createReactiveSet(target);
const cached = target[$PROXY];
if (cached) return cached;

// After — cache check moved above the instanceof branches
if (target[$RAW]) return target;
const cached = target[$PROXY];
if (cached) return cached;
if (target instanceof Map) return createReactiveMap(target);
if (target instanceof Set) return createReactiveSet(target);
```

Safe because raw Maps/Sets never carry a `$PROXY` own-property (their proxies
live in `collectionProxyCache` in `collections.ts`), so the moved check can't
shadow Map/Set dispatch. All 707 tests passed.

### Change 2: drop redundant `getActiveSub()` in `trackArrayVersion` (`read.ts`)

```ts
// Before
function trackArrayVersion(value: unknown): void {
  if (Array.isArray(value) && getActiveSub()) { ... }
}
// After — sole caller (the get trap) already gates on getActiveSub()
function trackArrayVersion(value: unknown): void {
  if (Array.isArray(value)) { ... }
}
```

### Also tried and dropped: `isWrappable`/`wrap` type-check dedup

Splitting `isWrappable` into `isWrappable` + `isWrappableObject` so `wrap` skips
a redundant `null`/`typeof` re-check. Measured flat-to-slightly-negative on its
own, and plausibly de-inlines `isWrappable` at the hot `get`-trap call site
(`read.ts:99`), so it was dropped before the others were even benchmarked.

## Methodology

Kernel vitest benchmarks (`pnpm exec vitest bench`), focused on read-sensitive
benches: `Property Read: 1M` (hits `createReactiveProxy` 1M×) and `real-overhead`
`proxy` reads. Run **n=4 interleaved** per variant (alternating branch/baseline
via `git stash` to cancel machine drift), across **two independent rounds**.
Metric is `hz` — **higher = faster**.

## Results

Aggregate deltas (after vs baseline) looked like a small consistent win:

| Bench         | round 1 | round 2 |
| ------------- | ------: | ------: |
| Property Read 1M | +1.8% | +2.6% |
| proxy, 3 reads   | +3.2% | +6.9% |
| proxy, 1 read    | +3.8% | −7.3% |

But the per-run samples tell the real story — the distributions fully overlap:

```
Property Read 1M (hz, higher=faster)
  r1 after: 3.50 3.53 3.54 3.48 | base: 3.57 3.64 3.19 3.40
  r2 after: 3.50 3.40 3.39 3.68 | base: 3.50 3.31 3.40 3.41
proxy_3read
  r1 after: 36.6 36.4 39.0 34.3 | base: 37.3 34.6 35.2 34.7
  r2 after: 37.0 35.2 36.6 37.9 | base: 28.9 34.3 37.8 36.4
```

Baseline holds both the highest (3.64) and lowest (3.19) PropRead1M values. The
"+6.9%" proxy_3read gain was driven entirely by one `28.9` outlier in a baseline
sample. proxy_1read swung +3.8% → −7.3% between rounds. There is no separation.

An earlier single-run `vitest bench --compare` was even more misleading:
PropRead1M `[1.06x]`, Granular Reactivity `[1.96x]` (on a ±15.7% rme bench),
proxy `[0.95x]` — all noise.

## Why It Failed

- **Aggregates hid outliers.** Means of 4 noisy runs are swung by a single GC/
  scheduling outlier in either direction. The deltas sat entirely inside the
  per-bench variance (sd 3–15%).
- **The checks are cheap.** `instanceof Map`/`Set` are monomorphic prototype
  walks; V8 runs them essentially for free. Removing two of them from a path
  whose cost is dominated by the proxy trap + signal read + effect machinery is
  unmeasurable.
- Consistent with the rest of `failed-approaches/`: proxy overhead is
  architectural, not implementational.

## Key Learnings

- **Inspect per-run distributions, not just mean deltas.** If "after" and
  "baseline" samples interleave, there is no effect — regardless of how
  consistent the mean delta looks. A within-noise delta is a failed experiment,
  not a small win.
- **Single-run `--compare` is unreliable here.** Use repeated interleaved runs,
  then look at the raw samples.
- Change 2 (`trackArrayVersion` dedup) is harmless and arguably cleaner, but
  carries no measurable benefit, so it isn't worth churning the
  deopt-sensitive `get` handler region for.

## Related

- [Inline Primitive Checks](inline-primitive-checks-optimization.md) — same lesson, the `wrap`/`unwrap` inlining version
- [Fast Push Bypass Proxy](fast-push-bypass-proxy.md) — one branch in the get handler regressed unrelated benchmarks 13–27%
- [Proxy Optimization Trade-offs](../architecture/proxy-optimization-trade-offs.md) — why the get handler shape is sensitive
