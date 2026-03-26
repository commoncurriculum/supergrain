# Optimization Brainstorm Prompt

You are analyzing a reactive store library called **supergrain** to find performance optimizations for the js-framework-benchmark (Krause benchmark). Your job is ONLY to propose ideas — not implement them.

## How to Get the Data

You must read actual source code and data before proposing anything. Here is how:

### Source code to read

- `packages/core/src/read.ts` — proxy read handler (hot path, cannot be structurally modified)
- `packages/core/src/write.ts` — proxy write handler, setProperty, bumpVersion
- `packages/core/src/core.ts` — signal node management, getNodes, getNode
- `packages/react/src/tracked.ts` — tracked() wrapper for React components
- `packages/react/src/use-store.ts` — For component (list rendering)
- `packages/react/src/use-computed.ts` — useComputed hook
- `packages/react/src/provide-store.ts` — React context provider
- `packages/js-krauset/src/main.tsx` — the benchmark app (Row, App, operations)

### Failed approaches to consult

Read ALL files in `notes/failed-approaches/` before proposing anything. There are 20+ documented failed experiments. If your idea overlaps with a failed approach, you must explain specifically why your version is different.

### Performance data to gather

Run these commands from `packages/js-krauset`:

```
pnpm perf:profile
pnpm perf:analyze
pnpm perf:analyze create-1k
pnpm perf:analyze replace-1k
pnpm perf:analyze partial-update
pnpm perf:analyze append-1k
pnpm perf:analyze clear-rows
```

Read the existing baseline stats:

- `packages/js-krauset/perf-stats-branch.json` (or `perf-stats-branch2.json`)

### Architecture notes to read

- `notes/performance/` — all files (profiling results, architecture analysis)
- `OPTIMIZATION-AGENT.md` — benchmarking methodology, Krause weights
- `CLAUDE.md` — project structure

## Constraints

- **SSR must always work.** No client-only assumptions.
- **Total time matters, not script time.** Total = script + paint. Reducing renders reduces paint.

## Your Task

After reading the source code, profiling data, AND all failed approaches:

1. **Profile every benchmark** — not just create-10k. Look at what functions appear in EACH benchmark's profile. Find patterns.

2. **Trace the render path** — for each benchmark operation, trace exactly what components render, what signals fire, what effects run, what DOM mutations happen. Count them.

3. **Compare with fast frameworks** — what do the fastest keyed React implementations do differently? What React patterns minimize reconciliation, commit phase work, and paint?

4. **Propose ideas** — for each idea, explain:
   - What specifically would change (code/architecture level)
   - Which benchmark it targets and why (backed by profiling data)
   - What the risk is
   - Why it's different from every relevant failed approach

Focus on how supergrain's React integration causes React to do work. The library's own JS is <2% of total time — the optimization is in what React and the browser DO as a result of how supergrain structures components, triggers renders, and manages the reactive graph.
