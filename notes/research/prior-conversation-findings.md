# Prior Conversation Research Findings

## Transcript Locations

Conversation transcripts are stored at:
```
~/.claude/projects/-Users-scottamesmessinger-code-commoncurriculum-supergrain/
├── 0700a6e1-5b11-48f4-8cb7-997374510ceb.jsonl  (14.2MB — main research conversation)
├── 4e8dd6cb-8732-4b45-bbb1-b20a7b13b5ec.jsonl  (4.5MB — follow-up conversation)
└── 550ba10d-b26a-45e3-8578-6be2f4bd049b.jsonl  (1.2MB — smaller conversation)
```

All three contain references to preact signals, solid store, and alien-signals. The 14MB file is likely the primary research conversation where the prototype was designed.

## Alien-Signals vs Preact-Signals Benchmarks

Versions tested: alien-signals 2.0.7, @preact/signals-core 1.14.0

| Benchmark | alien-signals | preact | Winner |
|-----------|------------:|-------:|--------|
| Single signal read in effect (100k) | 1,519 ops/s | 4,608 ops/s | **preact 3.0x faster** |
| Multiple signals read (10×10k) | 1,059 ops/s | 4,085 ops/s | **preact 3.9x faster** |
| 10-deep computed chain (100k) | 1,477 ops/s | 3,136 ops/s | **preact 2.1x faster** |
| Propagation (100 effects, 1k updates) | 439 ops/s | 389 ops/s | **alien 1.13x faster** |

**Key insight**: Preact signals are 2-4x faster at READS. Alien-signals is only 13% faster at PROPAGATION (notifying effects when values change). alien-signals was chosen by Vue for the js-reactivity-benchmark, which measures graph propagation — but supergrain's use case is read-heavy (lots of component renders reading properties, fewer writes). Preact's per-read advantage matters more for this use case.

**Open question from that research**: Should supergrain switch from alien-signals to preact/signals-core? The 2-4x read speedup would apply to every property access in every component render. This was never resolved.

## Solid-js Store vs Supergrain — Why Solid is Faster

### The 60x proxy overhead breakdown

From the proxy overhead analysis:
- Basic proxy trap dispatch: ~45x vs direct access
- `getCurrentSub()` calls: additional 14x per access
- `Reflect.get` operations: additional 16x (later optimized away)
- Symbol property access (`$NODE`, `$RAW`): 37x slower than string property access
- `hasOwnProperty` checks: 15x (later removed)

### How Solid's store actually works

Both solid and supergrain use proxies for store access. Both use signals internally. The key differences:

1. **Solid's compiler eliminates proxy reads at render time**: Solid compiles JSX into direct DOM update functions. `{store.title}` in a Solid template becomes a direct signal subscription that updates the text node — the proxy is only read ONCE during setup, not on every re-render.

2. **React forces re-reading through the proxy**: In React, every re-render re-executes the component function, which re-reads every property through the proxy. There's no way to "compile away" the proxy reads because React's model is function re-execution.

3. **Supergrain's proxy handler is heavier than Solid's**: Supergrain checks `$RAW`, `$PROXY`, `$TRACK`, `$VERSION`, typeof function, getCurrentSub — 6+ checks per property access. This adds up across thousands of reads per render cycle.

### Supergrain vs Solid benchmark numbers

- Reactive reads: supergrain **27-66x slower** than solid-js
- Property updates: **nearly equal** (only 1.06x slower)
- Store creation: supergrain **82x faster**

The reads are the problem. Updates are fine.

## The Computed Caching Architecture (validated)

The key insight from the prototype research:

`computed(() => store.prop)` — wraps a proxy read in a computed signal. The proxy read happens ONCE (when the computed evaluates). Subsequent reads return the cached signal value at signal speed, not proxy speed.

**Benchmark validation**: computed() wrapping proxy adds ZERO overhead over raw alien-signals:
- Raw alien signal read: 1,504 ops/s
- computed() over proxy read: 1,488 ops/s
- Difference: negligible

This means: if you can cache proxy reads inside computed() signals, you get proxy-level reactivity tracking at signal-read speed. The proxy is only traversed when the underlying value actually changes (the computed re-evaluates).

**This is conceptually what Solid does** — read through the proxy once to set up the reactive binding, then use the cached signal for subsequent reads.

## Prototype Benchmark Results (compiled approach using this architecture)

| Scenario | Compiled | Proxy (current) | solid-js/store | vs solid |
|----------|------:|------:|------:|:------|
| Component render (8 reads, 1k mutations) | 6,322 | 1,148 | 5,354 | **1.18x faster** |
| Fine-grained (10 components, 1k mutations) | 7,589 | 2,663 | 5,061 | **1.50x faster** |
| Batched (5 props, 1k batches) | 1,269 | 734 | 917 | **1.38x faster** |
| Deep updates (100 nested) | 61,426 | 13,524 | 19,951 | **3.08x faster** |

Compiled supergrain beat solid-js in every scenario.

## What Still Needs Investigation

These topics were raised but not fully explored in the prior conversations:

1. **Switching to preact/signals-core**: 2-4x faster reads would compound with the compiled approach. Was never tested end-to-end.

2. **How Solid's `mapArray` works for lists**: Solid's `<For>` uses `mapArray` which creates stable DOM references per item. When an item changes, only that DOM node updates — no component re-render. Supergrain's `<For>` re-renders the parent component and relies on React.memo.

3. **The React tax**: How much of the krauset benchmark time is React reconciliation vs store reads? Never profiled. If React dominates, no amount of store optimization helps — you'd need to bypass React's update pipeline entirely.

4. **Computed caching in practice**: The computed() approach was validated in micro-benchmarks but never integrated into the actual store or tested end-to-end with React components.

## Files Referenced

- `packages/core/PLAN-model-api.md` — The compiled approach plan with benchmark evidence
- `notes/proxy-overhead-analysis.md` — Detailed proxy overhead breakdown
- `notes/PROXY_OVERHEAD_SUMMARY.md` — Summary of proxy overhead findings
- `notes/architecture/solid-architecture.md` — How Solid achieves performance
- `notes/benchmarks/consolidated-findings.md` — Full benchmark journey
- `notes/benchmarks/performance-analysis.md` — Corrected solid-js comparison
- `memory/project_alien_vs_preact_benchmark.md` — alien vs preact benchmark summary

## Deleted Prototype Files (were in packages/core/prototype/, deleted in commit 18c40ef)

These files contained the research benchmarks and implementations:
- `compiled-reads.bench.ts` — Direct signal reads vs proxy reads
- `compiled-alien-vs-preact.bench.ts` — Compiled approach with alien vs preact signals
- `compiled-vs-stores.bench.ts` — Reactive reads comparing compiled, proxy, solid
- `compiled-correctness.test.ts` — Correctness validation for compiled approach
- `direct-signal-correctness.test.ts` — Direct $NODE signal read validation
- `direct-signal-reads.bench.ts` — Per-operation signal read benchmarks
- `computed-vs-signal.bench.ts` — computed() vs proxy vs raw signal comparison
- `call-overhead.bench.ts` — alien vs preact head-to-head
- `model.ts`, `model.bench.ts`, `model.test.ts` — ArkType-based model prototype
- `preact-store.ts`, `preact-store-correctness.test.ts` — Preact-backed store experiment

These were deleted when we cleaned up prototypes. The code is recoverable from git history (commit before 18c40ef).
