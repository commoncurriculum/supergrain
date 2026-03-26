# AI Assistant Instructions for Supergrain Project

This document provides important instructions for AI assistants working on the Supergrain project.

## Project Overview

Supergrain is a reactive store library with fine-grained reactivity. The project uses pnpm workspaces with multiple packages:

- `@supergrain/core` - Core reactive store implementation
- `@supergrain/react` - React integration and hooks
- `@supergrain/store` - Document-oriented store for app-level state management
- `@supergrain/documentation` - Documentation and example tests
- `js-framework-benchmark-react-supergrain` - Performance benchmarks

## Required Commands After Code Changes

**IMPORTANT**: After making any code changes, you MUST run ALL of the following checks. These mirror exactly what CI runs — if any fail locally, CI will fail too.

```bash
pnpm test              # Unit tests across all packages
pnpm run test:validate # README/docs documentation validation
pnpm run typecheck     # TypeScript type checking across all packages
pnpm lint              # Linting across all packages
pnpm format            # Formatting (oxfmt)
```

**All five commands must pass before pushing or considering any code changes complete.** Do NOT skip `test:validate` — it catches orphaned doc tests and missing DOC_TEST identifiers.

## Package-specific Commands

If working on a specific package, you can run tests/typecheck for just that package:

```bash
# Run tests for specific package
cd packages/[package-name]
pnpm test

# Run typecheck for specific package
cd packages/[package-name]
pnpm run typecheck
```

## CI/CD

The project uses GitHub Actions CI that runs:

1. `pnpm test` - All tests across all packages
2. `pnpm run test:validate` - README documentation validation
3. `pnpm run typecheck` - Type checking across all packages

## Documentation Tests

The documentation package (`@supergrain/documentation`) contains special tests that validate README examples:

- Tests are linked to README code blocks via `#DOC_TEST_XX` identifiers
- All React state updates in tests must be wrapped in `act()` to prevent warnings
- Tests run in browser environment using Vitest + Playwright

## Key Guidelines

1. **Always run tests and typecheck** - Both must pass after any changes
2. **Maintain documentation consistency** - README examples must match test implementations
3. **Use proper React testing patterns** - Wrap state updates in `act()`
4. **Follow TypeScript best practices** - All code must be properly typed
5. **Preserve fine-grained reactivity** - Ensure changes don't break reactive behavior

## Common Issues

- **React act() warnings**: Wrap store updates in tests with `act(() => { update(...) })`
- **Type errors**: Run `pnpm run typecheck` to catch TypeScript issues early
- **Documentation test failures**: Ensure README examples match test expectations
- **Module resolution**: Use proper imports and check package.json exports

## Benchmark Package (`packages/js-krauset`)

This package contains the js-framework-benchmark implementation for supergrain. It uses React 19 + `@supergrain/core` + `@supergrain/react`.

### How it works

- `src/main.tsx` — The benchmark app. React renders everything (buttons, table, rows) into `#main`. All store operations (run, add, update, clear, swapRows, remove, select) are triggered via React onClick handlers.
- `src/dist.test.ts` — Correctness tests. Builds the production bundle, serves it via a static HTTP server, and validates in Playwright. Mirrors the same checks as `js-framework-benchmark/webdriver-ts/src/isKeyed.ts`.
- `src/perf.test.ts` — Performance benchmarks. Same Playwright setup but uses Chrome DevTools Protocol tracing to measure script + paint time, matching how Krause measures. Includes CPU throttling per-benchmark (4x for update/select/swap/clear, 2x for remove).
- `src/test-helpers.ts` — Shared Playwright/server setup for both test files.

### Development workflow

Changes to `packages/core` or `packages/react` are immediately reflected via pnpm workspace links and vite aliases. No need to rebuild or republish.

```bash
cd packages/js-krauset

# Correctness tests (builds prod bundle, runs in Playwright)
pnpm test
```

### Benchmarking workflow

All commands run from `packages/js-krauset`.

**Single run** (quick sanity check):

```bash
pnpm test:perf
```

Writes `perf-results.txt` (human-readable), `perf-results.json` (latest, overwritten each run), and `perf-results-<timestamp>.json` (unique per run). Each JSON contains per-benchmark metrics: total, script, paint, layouts, numberCommits, maxDeltaBetweenCommits, rafLongDelay, plus git metadata.

**Statistical run** (for real comparisons):

```bash
pnpm perf:stats <name> <runs>
# e.g. pnpm perf:stats baseline 15
```

Runs `pnpm test:perf` N times, then computes mean/median/stddev/min/max across all runs for every metric. Saves to `perf-stats-<name>.json`. Only uses JSON files generated during that invocation (ignores pre-existing files).

**Comparing before/after**:

```bash
# 1. On main (or before your change):
pnpm perf:stats baseline 15

# 2. On your branch (or after your change):
pnpm perf:stats optimized 15

# 3. Compare:
pnpm perf:compare baseline optimized
```

### Submitting to js-framework-benchmark

The benchmark repo submission lives at `https://github.com/commoncurriculum/js-framework-benchmark` on the `add-supergrain` branch. When copying files to the benchmark repo:

1. Copy `src/main.tsx`, `index.html`, `vite.config.ts`, `tsconfig.json`
2. Create a standalone `package.json` with published npm versions (e.g., `@supergrain/core: "1.0.4"`) instead of `workspace:*`
3. Remove the vite alias (the benchmark repo uses published packages, not local source)
4. Add `"customURL": "/dist"` to the `js-framework-benchmark` section of package.json

## Benchmarking Rules

**NEVER write custom benchmark scripts or test files.** The project already has `perf.test.ts` and `perf-stats.ts` in `packages/js-krauset` which exactly match the js-framework-benchmark methodology (Krause's warmup counts, CPU throttling rates, CDP tracing). Use `pnpm test:perf` for quick checks, `pnpm perf:stats <name> <runs>` for real comparisons.

- Do NOT create bash scripts, python scripts, or new TS test files for benchmarking
- Do NOT reinvent warmup logic, tracing, or timing — perf.test.ts already does it correctly
- Do NOT dismiss consistent benchmark results as "noise" — if a number is consistently higher across runs, it's real
- Save baseline stats once (`pnpm perf:stats baseline 15`) and reuse them — don't re-run baselines every time
- When comparing, use `pnpm perf:stats` on both baseline and branch, then compare the JSON files

## Package Manager

This project uses **pnpm** with workspace support. Always use `pnpm` instead of `npm` or `yarn`.
