# @supergrain/husk

## 0.2.0

### Minor Changes

- b61db1b: Split side-effect primitives into a new package, `@supergrain/husk`.

  ## New package: `@supergrain/husk`

  `@supergrain/husk` is the layer between kernel's reactive core and application-specific data layers. It ships five primitives + their React hooks:

  - **`resource(initial, setup)`** — inline, one-off reactive function with cleanup. Reactive reads in `setup` drive reruns.
  - **`defineResource(initial, setup)`** — returns a reusable `ResourceFactory<Args, T>`. Each factory call produces an independent instance; callers pass an `argsFn` thunk whose reactive reads drive reruns. Setup reads are NOT tracked in the factory form — "what triggers a rerun" lives at the call site.
  - **`dispose(resource)`** — free function; stops a resource permanently. Idempotent, safe on any object.
  - **`reactivePromise(asyncFn)`** — inline async envelope (`data`, `error`, `isPending`, `isResolved`, `isRejected`, `isSettled`, `isReady`, `promise`). Reactive reads in `asyncFn`'s sync prefix drive reruns; previous runs abort via `AbortSignal`. Matches SWR / TanStack Query / Apollo / silo field names.
  - **`reactiveTask(asyncFn)`** — imperative `.run(...)` command. Same envelope as `reactivePromise`, no auto-tracking.
  - **`modifier(fn)` + `useModifier(m, ...args)`** — element-scoped setup/teardown. Args flow through an internal ref so fresh closures per render don't re-register; signal reads inside setup trigger targeted re-attach on the element **without re-rendering the component**.

  Install:

  ```bash
  pnpm add @supergrain/kernel @supergrain/husk
  ```

  ## BREAKING: removed from `@supergrain/kernel`

  The following were moved out of `@supergrain/kernel` and `@supergrain/kernel/react` into `@supergrain/husk` and `@supergrain/husk/react`:

  - `resource`, `defineResource`, `dispose`, `ResourceContext`, `ResourceFactory`
  - `reactivePromise`, `ReactivePromise`
  - `reactiveTask`, `ReactiveTask`
  - `useResource`, `useReactivePromise`, `useReactiveTask`
  - `modifier`, `useModifier`, `Modifier`

  ### Migration

  ```diff
  -import { resource, defineResource, reactivePromise, reactiveTask, dispose } from "@supergrain/kernel";
  +import { resource, defineResource, reactivePromise, reactiveTask, dispose } from "@supergrain/husk";

  -import { useResource, useReactivePromise, useReactiveTask, modifier, useModifier } from "@supergrain/kernel/react";
  +import { useResource, useReactivePromise, useReactiveTask, modifier, useModifier } from "@supergrain/husk/react";
  ```

  Kernel continues to export the reactive core (`createReactive`, `computed`, `effect`, `signal`, `batch`) and state-centric React bindings (`tracked`, `useReactive`, `useComputed`, `useSignalEffect`, `createStoreContext`, `For`).

  ## Why the split

  kernel's tagline is "reactive store for React." `resource` / `reactivePromise` / `reactiveTask` / `modifier` are side-effect primitives built _on top of_ reactivity — different concern, different audience. The ecosystem models these as separate layers (TanStack Query is separate from any state library). Separating lets each package iterate independently and keeps kernel focused on state.

  ## Fix: resources created inside `tracked()` render now propagate correctly

  While splitting, surfaced a correctness bug: resources created inside a `tracked()` component's render body did not re-run on their own reactive reads (setup reads for `resource`, argsFn reads for `defineResource`). Root cause: alien-signals' `effect()` links a new effect as a dep of `activeSub` when one exists, so the resource's effect was becoming nested under tracked's effect instead of standing alone. The resource's effect callback would no longer fire independently on its deps changing.

  Fix: resources now create their effect with `activeSub` reset to `undefined`, so the effect is always top-level regardless of where the resource is instantiated. Module-scope usage was unaffected; anyone using `useResource` / `useReactivePromise` / `useReactiveTask` inside a `tracked()` component with reactive reads in setup/argsFn will see the expected behavior now.

### Patch Changes

- Updated dependencies [b61db1b]
- Updated dependencies [d4a918b]
  - @supergrain/kernel@5.0.0
