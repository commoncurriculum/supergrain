# Benchmarks

## How to run

```bash
# Run a specific benchmark
pnpm bench benchmarks/core-comparison.bench.ts

# Run all benchmarks
pnpm bench
```

## Cross-Library Comparisons

These compare supergrain against other reactive store libraries:

| File | What it measures |
|------|-----------------|
| `core-comparison.bench.ts` | supergrain vs solid-js (store creation, reads, effects, updates, batching) |
| `state-libraries.bench.ts` | supergrain vs zustand, jotai, valtio, mobx, preact/signals |
| `additional.bench.ts` | Proxy overhead analysis, effect lifecycle, complex scenarios |
| `row-operations.bench.ts` | Table row operations (select, swap) — krauset-style |

Results: See the corresponding .md files (CORE_COMPARISON.md, etc.)

## Internal Optimization Comparisons

These compare different read strategies within supergrain:

| File | What it measures | Key finding |
|------|-----------------|-------------|
| `compiled-comparison.bench.ts` | proxy vs createView vs schema store | createView 8x faster than proxy per-read |
| `exhaustive-read-patterns.bench.ts` | 15 different signal read patterns | Class getters: 4,400 ops/s. Function calls: 500. Proxy: 450. |
| `getter-patterns.bench.ts` | Dynamic vs static prototype getters | Dynamic matches static — no compiler needed |
| `real-overhead.bench.ts` | Per-operation cost (cached vs uncached $NODE) | Cached $NODE 14x faster than proxy |

## Utilities

| File | Purpose |
|------|---------|
| `validate-benchmarks.ts` | Correctness validation before trusting perf numbers |
| `declarations.d.ts` | Type declarations for benchmark imports |
