# @supergrain/devtools

A floating, in-app inspector for Supergrain — modeled on the
[TanStack Query](https://tanstack.com/query) devtools. Today it inspects a
[`@supergrain/silo`](../silo) document store; it's structured so other
inspectors (a raw `@supergrain/kernel` store, the profiler) can become
additional tabs later.

## Install

```bash
pnpm add -D @supergrain/devtools
```

`react` is a peer dependency. `@supergrain/silo` and `@supergrain/kernel` come
along as dependencies.

## Usage

Drop `<SupergrainDevtools>` next to your app and hand it the store you got from
`createDocumentStore` (or from a Provider's `useDocumentStore()`):

```tsx
import { SupergrainDevtools } from "@supergrain/devtools/react";

function Root() {
  return (
    <>
      <App />
      <SupergrainDevtools store={store} initialIsOpen={false} />
    </>
  );
}
```

Keep it out of production bundles with the `disabled` prop:

```tsx
<SupergrainDevtools store={store} disabled={process.env.NODE_ENV === "production"} />
```

Inspecting several stores at once:

```tsx
<SupergrainDevtools stores={{ app: appStore, admin: adminStore }} />
```

### Props

| Prop            | Type                                         | Default          | Description                                |
| --------------- | -------------------------------------------- | ---------------- | ------------------------------------------ |
| `store`         | `DocumentStore` (or its bridge)              | —                | A single store to inspect.                 |
| `stores`        | `Record<string, DocumentStore>`              | —                | Several named stores, shown in a selector. |
| `initialIsOpen` | `boolean`                                    | `false`          | Open the panel on mount.                   |
| `position`      | `"bottom-right" \| "bottom-left" \| "top-*"` | `"bottom-right"` | Corner the toggle anchors to.              |
| `disabled`      | `boolean`                                    | `false`          | Render nothing at all.                     |

## What you see

- **Documents** and **Queries** tabs with live counts.
- Each cached entry grouped by type, with a status badge
  (`pending` / `success` / `error` / `fetching`).
- A detail pane for the selected entry: `status`, `isFetching`, `failureCount`,
  `fetchedAt`, and a collapsible explorer of its value (and error, if any).
- A filter box, a per-store **Clear** action, and a status dot on the collapsed
  toggle that turns blue while fetching and red on errors.

Everything updates reactively as fetches settle and documents change. The panel
reads the store's state directly and **never calls `find`**, so opening it can't
trigger a fetch.

## How it connects

`createDocumentStore` attaches a non-enumerable devtools bridge to every store
under a `Symbol.for("@supergrain/silo.devtools")` key, exposed via
`@supergrain/silo/devtools`. The bridge hands out the store's live reactive
state plus its configured type names — enough to read and subscribe, nothing
that widens the public store API.

## Framework-agnostic core

The root entry (`@supergrain/devtools`) has no React dependency and is the data
layer the UI is built on — useful for custom inspectors, logging, or tests:

```ts
import { snapshotSilo, serialize } from "@supergrain/devtools";

const snap = snapshotSilo(store); // { documents, queries, totals }
// Run inside a kernel effect()/tracked() scope to subscribe to changes.
```

- `snapshotSilo(store, options?)` — a plain snapshot of the cache. Pass
  `includeValue` to serialize the value/error of selected entries only.
- `serialize(value, options?)` — turn an arbitrary (possibly reactive,
  possibly cyclic) value into a depth/breadth-capped `JsonNode` tree.
