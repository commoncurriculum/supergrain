---
"@supergrain/kernel": major
"@supergrain/silo": major
"@supergrain/husk": minor
---

Split side-effect primitives into a new package, `@supergrain/husk`, and align
the public vocabulary across packages: kernel uses `grain` / `granary`, silo
uses `silo`, husk replaces `modifier` with `behavior`.

## BREAKING: renames in `@supergrain/kernel` and `@supergrain/kernel/react`

| Before               | After                  |
| -------------------- | ---------------------- |
| `createReactive`     | `createGrain`          |
| `useReactive`        | `useGrain`             |
| `createStoreContext` | `createGranaryContext` |
| `useStore`           | `useGranary`           |

```diff
-import { createReactive } from "@supergrain/kernel";
+import { createGrain } from "@supergrain/kernel";

-import { useReactive, createStoreContext } from "@supergrain/kernel/react";
+import { useGrain, createGranaryContext } from "@supergrain/kernel/react";

-export const { Provider, useStore } = createStoreContext<AppState>();
+export const { Provider, useGranary } = createGranaryContext<AppState>();
```

## BREAKING: renames in `@supergrain/silo` and `@supergrain/silo/react`

Functions and the store type now use the `silo` vocabulary throughout:

| Before                       | After               |
| ---------------------------- | ------------------- |
| `createDocumentStore`        | `createSilo`        |
| `createDocumentStoreContext` | `createSiloContext` |
| `useDocumentStore`           | `useSilo`           |
| `DocumentStore<M, Q>`        | `Silo<M, Q>`        |
| `DocumentStoreConfig<M, Q>`  | `SiloConfig<M, Q>`  |
| `InitialDocumentStoreData`   | `InitialSiloData`   |

```diff
-import { type DocumentStore } from "@supergrain/silo";
-import { createDocumentStoreContext } from "@supergrain/silo/react";
+import { type Silo } from "@supergrain/silo";
+import { createSiloContext } from "@supergrain/silo/react";

-export const { Provider, useDocumentStore, useDocument, useQuery } =
-  createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();
+export const { Provider, useSilo, useDocument, useQuery } =
+  createSiloContext<Silo<TypeToModel, TypeToQuery>>();
```

`DocumentHandle<T>`, `DocumentAdapter`, `DocumentTypes`, `useDocument`, and
`insertDocument` are unchanged — they describe individual documents, where the
existing vocabulary still fits.

## New package: `@supergrain/husk`

`@supergrain/husk` is the layer between kernel's reactive core and application-specific data layers. It ships five primitives + their React hooks:

- **`resource(initial, setup)`** — inline, one-off reactive function with cleanup. Reactive reads in `setup` drive reruns.
- **`defineResource(initial, setup)`** — returns a reusable `ResourceFactory<Args, T>`. Each factory call produces an independent instance; callers pass an `argsFn` thunk whose reactive reads drive reruns. Setup reads are NOT tracked in the factory form — "what triggers a rerun" lives at the call site.
- **`dispose(resource)`** — free function; stops a resource permanently. Idempotent, safe on any object.
- **`reactivePromise(asyncFn)`** — inline async envelope (`data`, `error`, `isPending`, `isResolved`, `isRejected`, `isSettled`, `isReady`, `promise`). Reactive reads in `asyncFn`'s sync prefix drive reruns; previous runs abort via `AbortSignal`. Matches SWR / TanStack Query / Apollo / silo field names.
- **`reactiveTask(asyncFn)`** — imperative `.run(...)` command. Same envelope as `reactivePromise`, no auto-tracking.
- **`behavior(fn)` + `useBehavior(m, ...args)`** — element-scoped setup/teardown. Args flow through an internal ref so fresh closures per render don't re-register; signal reads inside setup trigger targeted re-attach on the element **without re-rendering the component**.

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
- `behavior`, `useBehavior`, `Behavior`

### Migration

```diff
-import { resource, defineResource, reactivePromise, reactiveTask, dispose } from "@supergrain/kernel";
+import { resource, defineResource, reactivePromise, reactiveTask, dispose } from "@supergrain/husk";

-import { useResource, useReactivePromise, useReactiveTask, behavior, useBehavior } from "@supergrain/kernel/react";
+import { useResource, useReactivePromise, useReactiveTask, behavior, useBehavior } from "@supergrain/husk/react";
```

Kernel continues to export the reactive core (`createGrain`, `computed`, `effect`, `signal`, `batch`) and state-centric React bindings (`tracked`, `useGrain`, `useComputed`, `useSignalEffect`, `createGranaryContext`, `For`).

## Why the split

kernel's tagline is "reactive store for React." `resource` / `reactivePromise` / `reactiveTask` / `behavior` are side-effect primitives built _on top of_ reactivity — different concern, different audience. The ecosystem models these as separate layers (TanStack Query is separate from any state library). Separating lets each package iterate independently and keeps kernel focused on state.

## Fix: resources created inside `tracked()` render now propagate correctly

While splitting, surfaced a correctness bug: resources created inside a `tracked()` component's render body did not re-run on their own reactive reads (setup reads for `resource`, argsFn reads for `defineResource`). Root cause: alien-signals' `effect()` links a new effect as a dep of `activeSub` when one exists, so the resource's effect was becoming nested under tracked's effect instead of standing alone. The resource's effect callback would no longer fire independently on its deps changing.

Fix: resources now create their effect with `activeSub` reset to `undefined`, so the effect is always top-level regardless of where the resource is instantiated. Module-scope usage was unaffected; anyone using `useResource` / `useReactivePromise` / `useReactiveTask` inside a `tracked()` component with reactive reads in setup/argsFn will see the expected behavior now.
