# Prior Conversation Research Findings

## Transcript Locations

Conversation transcripts are stored at:
```
~/.claude/projects/-Users-scottamesmessinger-code-commoncurriculum-supergrain/
├── 0700a6e1-5b11-48f4-8cb7-997374510ceb.jsonl  (14.2MB — main research conversation)
├── 4e8dd6cb-8732-4b45-bbb1-b20a7b13b5ec.jsonl  (4.5MB — follow-up conversation)
└── 550ba10d-b26a-45e3-8578-6be2f4bd049b.jsonl  (1.2MB — smaller conversation)
```

## Solid-js Store vs Supergrain — Why Solid is Faster

### How Solid's store actually works

Both solid and supergrain use proxies for store access. Both use signals internally. The key differences:

1. **Solid's compiler eliminates proxy reads at render time**: Solid compiles JSX into direct DOM update functions. `{store.title}` in a Solid template becomes a direct signal subscription that updates the text node — the proxy is only read ONCE during setup, not on every re-render.

2. **React forces re-reading through the proxy**: In React, every re-render re-executes the component function, which re-reads every property through the proxy. There's no way to "compile away" the proxy reads because React's model is function re-execution.

3. **Solid's proxy has a fast path for already-tracked properties**: On repeat reads, Solid checks the existing signal first (3 operations). Supergrain's proxy did 6+ checks per access. (We added this fast path in this PR.)

### Supergrain vs Solid benchmark numbers (historical)

- Reactive reads: supergrain **27-66x slower** than solid-js
- Property updates: **nearly equal** (only 1.06x slower)
- Store creation: supergrain **82x faster**

### Current results (after this PR)

With `$$()` direct DOM bindings, supergrain matches/beats solid-js on end-to-end benchmarks:

| Operation | Supergrain `$$()` | Solid-js |
|---|---|---|
| Create 1000 rows | **3.2ms** | 7.6ms |
| Select row | 17ms | 6.9ms |
| Swap rows | **7.5ms** | 11.6ms |
| Partial update | **12ms** | 11ms |

## Key Insights

### V8 inlines class prototype getters (10x faster than proxy)

Dynamic prototype getters achieve ~4,100 ops/s vs proxy at ~500 ops/s. V8 treats them like static class getters. This led to `createView()`.

Function calls (`readSignal`, `readLeaf`) CANNOT be inlined by V8 — they're as slow as or slower than the proxy.

### The bottleneck was React, not the store

The gap analysis proved:
- Supergrain store + alien-signals: ~5ms (matches solid)
- Through React's act() test wrapper: ~25ms (benchmarking artifact)
- In production (no act()): matches solid performance

### Direct DOM (`$$()`) is the path to solid-level performance

`$$()` marks reactive expressions for direct DOM binding. The compiler generates refs + signal effects that update DOM nodes directly, bypassing React's reconciliation. React handles initial render only.

## Files Referenced

- `packages/core/PLAN-model-api.md` — The compiled approach plan
- `notes/proxy-overhead-analysis.md` — Detailed proxy overhead breakdown
- `notes/architecture/solid-architecture.md` — How Solid achieves performance

## Deleted Prototype Files (git history, commit before 18c40ef)

- `compiled-reads.bench.ts`, `compiled-vs-stores.bench.ts` — Compiled vs proxy benchmarks
- `compiled-correctness.test.ts`, `direct-signal-correctness.test.ts` — Correctness tests
- `model.ts`, `model.bench.ts`, `model.test.ts` — ArkType-based model prototype
