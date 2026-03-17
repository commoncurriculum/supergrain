# Benchmark Guide

> **Status**: Current. Overlaps significantly with [core-benchmarks-readme.md](./core-benchmarks-readme.md) -- that file has more detail on benchmark structure.
> **TL;DR**: Run `pnpm bench:core` (~30s) during development, `pnpm bench:all` before commits.

## Commands

```bash
cd packages/core
pnpm bench:core        # Core comparison vs solid-js (~30s)
pnpm bench:all         # Full suite (1-2 min)
pnpm bench:additional  # Detailed analysis only
```

## Benchmark Files

| File | Purpose | Runtime |
|------|---------|---------|
| `core-comparison.bench.ts` | vs solid-js: creation, access, updates, arrays, nesting, effects | ~30s |
| `additional.bench.ts` | Proxy overhead, memory, signals, MongoDB ops, depth analysis, edge cases | 1-2 min |

## When to Run What

- **Active development** (proxy, reactivity, arrays, setters): `pnpm bench:core`
- **Before commits/PRs**: `pnpm bench:all`
- **Investigating specific issues**: `pnpm bench:additional`
- **CI**: `pnpm bench:core`

## Performance Targets (vs solid-js/store)

| Operation | Target | Acceptable |
|-----------|--------|------------|
| Store creation | Within 1.5x | Within 2x |
| Property access | Within 2x | Within 3x |
| Property updates | Within 2x | Within 3x |
| Array operations | Within 3x | Within 4x |
| Memory usage | Within 1.5x | Within 2x |

## Red Flags
- Performance >5x slower than solid-js
- Standard deviation >10%
- Non-linear degradation with data size
- Memory not freed after dispose

## Reactive Context Validation

Both benchmark files verify effects track dependencies and updates trigger re-runs. If tracking fails, benchmarks throw immediately.

## Adding Benchmarks

1. Core comparison -> `core-comparison.bench.ts`; detailed analysis -> `additional.bench.ts`
2. Always include both @supergrain/core and solid-js versions
3. Add reactive validation for reactive benchmarks
4. Include plain JS baseline when measuring overhead

## Environment
- Node.js 18+, 8GB RAM min
- Close other apps for consistency
- Run benchmarks twice, use second results
