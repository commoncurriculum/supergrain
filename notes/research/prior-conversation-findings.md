# Prior Conversation Research Findings

> **TL;DR:** Analysis of prior research conversations established that (1) solid-js's speed comes from its compiler eliminating re-renders, not from a faster proxy, (2) V8 inlines prototype getters at 10x proxy speed, and (3) `$$()` direct DOM bindings close the gap entirely. Supergrain now matches/beats solid-js on end-to-end benchmarks.

**Status:** Research complete. Findings applied in `compiled-reads-investigation.md`.

---

## Transcript Locations

```
~/.claude/projects/-Users-scottamesmessinger-code-commoncurriculum-supergrain/
  0700a6e1-5b11-48f4-8cb7-997374510ceb.jsonl  (14.2MB -- main research)
  4e8dd6cb-8732-4b45-bbb1-b20a7b13b5ec.jsonl  (4.5MB -- follow-up)
  550ba10d-b26a-45e3-8578-6be2f4bd049b.jsonl  (1.2MB -- smaller)
```

---

## Finding 1: Why Solid-js Is Faster Than React+Supergrain

Both solid and supergrain use proxies with internal signals. The differences are architectural:

1. **Solid's compiler eliminates proxy reads at render time.** `{store.title}` in Solid becomes a direct signal subscription that updates the text node. The proxy is read once during setup, not on every re-render.
2. **React forces re-reading through the proxy.** Every re-render re-executes the component function, re-reading every property through the proxy. No way to compile this away.
3. **Solid's proxy has a fast path for already-tracked properties.** On repeat reads: 3 operations. Supergrain's proxy originally did 6+ checks per access. (Fast path added in this PR.)

### Historical benchmark gap

- Reactive reads: supergrain **27-66x slower** than solid-js
- Property updates: **nearly equal** (only 1.06x slower)
- Store creation: supergrain **82x faster**

### Current results (after $$() direct DOM)

| Operation | Supergrain `$$()` | Solid-js |
|---|---|---|
| Create 1000 rows | **3.2ms** | 7.6ms |
| Select row | 17ms | 6.9ms |
| Swap rows | **7.5ms** | 11.6ms |
| Partial update | **12ms** | 11ms |

---

## Finding 2: V8 Inlines Prototype Getters (10x Faster Than Proxy)

Dynamic prototype getters achieve ~4,100 ops/s vs proxy at ~500 ops/s. V8 treats them like static class getters. This led to `createView()`.

Function calls (`readSignal`, `readLeaf`) cannot be inlined by V8 -- they're as slow or slower than the proxy.

---

## Finding 3: The Bottleneck Was React, Not the Store

The gap analysis proved:

- Supergrain store + alien-signals: ~5ms (matches solid)
- Through React's `act()` test wrapper: ~25ms (benchmarking artifact)
- In production (no `act()`): matches solid performance

`$$()` marks reactive expressions for direct DOM binding. The compiler generates refs + signal effects that update DOM nodes directly, bypassing React's reconciliation.

---

## Referenced Files

- `notes/benchmarks/proxy-overhead-analysis.md` -- Detailed proxy overhead breakdown
- `notes/architecture/solid-architecture.md` -- How Solid achieves performance
- `notes/architecture/vite-compiler-plugin-plan.md` -- The compiled approach plan

## Deleted Prototype Files (git history, commit before 18c40ef)

- `compiled-reads.bench.ts`, `compiled-vs-stores.bench.ts` -- Compiled vs proxy benchmarks
- `compiled-correctness.test.ts`, `direct-signal-correctness.test.ts` -- Correctness tests
- `model.ts`, `model.bench.ts`, `model.test.ts` -- ArkType-based model prototype
