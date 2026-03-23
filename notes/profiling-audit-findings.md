# Profiling Audit Findings

Issues discovered while adding exact signal profiling assertions to all tests.

## Bugs

### 1. `$push` on nested array doesn't fire parent effect

- **File**: `packages/core/tests/core/store.test.ts` — "should handle nested reactivity in arrays"
- **What**: Effect reads `state.users[1]?.tasks`. After `$push` to tasks array, `effectFires: 0`. The effect never re-runs.
- **Why it appears to work**: `bobTasks` holds the same proxy reference, so `expect(bobTasks).toEqual(...)` passes because the proxy reflects the mutated array. But the effect body never re-executed — any derived computation (spread, map, length check, etc.) would be stale.
- **Root cause**: `$push` mutates the array in place. The `tasks` property signal on the user object holds the array reference, which doesn't change. No signal write → no effect fire.

### 3. Profiler didn't instrument ownKeys/length signal writes — FIXED

- **What**: `bumpOwnKeysSignal`, `bumpSignals` (length), `syncIndexedSignals`, and `deleteProperty` wrote signals without profiling.
- **Fix**: Added `profileSignalWrite()` to all four paths in write.ts and operators.ts. Updated assertions.

## Suspicious Numbers (needs investigation)

### 2. Array iteration signal reads seem high

- **File**: `packages/core/tests/core/store.test.ts` — "should handle array updates reactively"
- **Profile**: `signalReads: 22, signalSkips: 9` for iterating a 3-item array across 3 effect runs
- **Question**: Is `for..of` on a proxy array creating more subscriptions than necessary? Each iteration reads ownKeys + per-index signals + value signals. Need to verify this is the minimum.

## Deleted (redundant/investigation debris)

- `packages/react/tests/performance-analysis.test.tsx` — subset of for-component-magic
- `packages/react/tests/render-analysis.test.tsx` — investigation log, not regression tests
- `packages/react/tests/useTracked-mechanism.test.tsx` — duplicate of use-tracked.test.tsx
- `packages/react/tests/array-subscription-theory.test.tsx` — covered by for-component-magic
- `packages/react/tests/js-krauset-simple.test.tsx` — incomplete, no assertions on render counts
- `packages/react/tests/benchmark-correctness.test.tsx` — DOM correctness already in tracked.test.tsx
- `tracking-isolation.test.ts` test 2 — asserted on literal object, tested nothing

## Completed Files (exact profiling assertions)

- [x] `packages/core/tests/core/store.test.ts` — signalReads/Writes/effectFires on all effect tests
- [x] `packages/core/tests/core/profiler.test.ts` — profiler unit tests
- [x] `packages/core/tests/read/array.test.ts` — exact counts for index, loop, filter, push, pull
- [x] `packages/core/tests/read/tracking-isolation.test.ts` — profiling + removed fake test
- [x] `packages/core/tests/write/array-mutation.test.ts` — swap granularity assertions
- [x] `packages/react/tests/for-component-magic.test.tsx` — partial update + select profiling
- [x] `packages/react/tests/parent-invalidation.test.tsx` — tightened to exact render counts
- [x] `packages/js-krauset/src/dist.test.ts` — benchmark-scale profiling (1000 rows)

## Remaining Files (correctness tests, less critical for profiling)

- [ ] `packages/core/tests/write/deep-nesting.test.ts` — 18 deep CRUD tests, correctness focus
- [ ] `packages/core/tests/write/direct-mutation.test.ts` — direct mutation correctness
- [ ] `packages/core/tests/write/operators.test.ts` — operator correctness
- [ ] `packages/core/tests/write/todo.test.ts` — todo CRUD pattern
- [ ] `packages/react/tests/tracked.test.tsx` — render isolation + structural ops
- [ ] `packages/react/tests/deep-nesting.test.tsx` — React + deep nesting
- [ ] `packages/react/tests/direct-mutation-react.test.tsx` — React + direct mutation
- [ ] `packages/react/tests/use-store-todo.test.tsx` — React todo pattern
- [ ] `packages/react/tests/use-tracked.test.tsx` — tracked() basics
- [ ] `packages/react/tests/deep-nested-array-item.test.tsx` — deep array item access
