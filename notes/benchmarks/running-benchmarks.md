# Running Benchmarks

> **Status**: Current. How to run benchmarks and what each file measures. See [README.md](./README.md) for the full document index.
> **TL;DR**: Two benchmark files -- `core-comparison.bench.ts` (~30s, run during dev) and `additional.bench.ts` (1-2 min, deep analysis). Both include reactive context validation.

## Commands

```bash
cd packages/core
pnpm bench:core        # Core only (~30s)
pnpm bench:all         # Everything (1-2 min)
pnpm bench:additional  # Additional only
```

## core-comparison.bench.ts (~30s)

Essential vs-solid-js comparisons. Run during active development.

Covers: store creation, property access (reactive + non-reactive), property updates with effects, array operations, deep nesting, todo app scenario, MongoDB operators vs direct mutations, effect management, complex object updates.

All tests include reactive context validation -- throws immediately if effects aren't tracking.

## additional.bench.ts (1-2 min)

Deep analysis. Run before commits or when investigating issues.

Covers: proxy overhead (raw proxy vs plain object), memory/GC patterns, signal creation/caching, detailed MongoDB operators, depth impact (up to 10 levels), array method performance, complex use cases (forms, data grids, shopping carts, recursive trees), batch update patterns, edge cases (circular refs, symbol properties).

## Adding Benchmarks

1. Core comparison -> `core-comparison.bench.ts`; detailed -> `additional.bench.ts`
2. Include @supergrain/kernel and solid-js/store versions
3. Add reactive context validation for reactive tests
4. Include plain JS baseline when measuring overhead

```typescript
bench("my reactive test", () => {
  const [store] = createStore({ value: 0 });
  let effectRuns = 0;
  const dispose = effect(() => {
    effectRuns++;
    const _ = store.value;
  });
  if (effectRuns === 0) throw new Error("Effect did not run");
  // benchmark work...
  dispose();
});
```

## Performance Targets (vs solid-js/store)

| Operation        | Target      | Acceptable |
| ---------------- | ----------- | ---------- |
| Store creation   | Within 1.5x | Within 2x  |
| Property access  | Within 2x   | Within 3x  |
| Property updates | Within 2x   | Within 3x  |
| Array operations | Within 3x   | Within 4x  |
| Memory usage     | Within 1.5x | Within 2x  |
