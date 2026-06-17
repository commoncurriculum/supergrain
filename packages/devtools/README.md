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

`react` is a peer dependency. `@supergrain/silo`, `@supergrain/kernel`, and
[`react-aria-components`](https://react-spectrum.adobe.com/react-aria/) (which
powers the panel's accessible controls — keyboard nav, focus management, ARIA)
come along as dependencies.

The panel is styled with Tailwind in the [Untitled UI](https://www.untitledui.com/)
design language, but ships as a **prebuilt, self-contained `style.css`** — you
don't need Tailwind in your own app, and it carries no global reset, so it won't
restyle anything outside the panel.

## Usage

Import the stylesheet once (anywhere in your app's entry), then drop
`<SupergrainDevtools>` next to your app and hand it the store you got from
`createDocumentStore` (or from a Provider's `useDocumentStore()`):

```tsx
import "@supergrain/devtools/style.css";
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
| `store`         | `unknown` — pass a silo `DocumentStore`      | —                | A single store to inspect.                 |
| `stores`        | `Record<string, unknown>` — silo stores      | —                | Several named stores, shown in a selector. |
| `initialIsOpen` | `boolean`                                    | `false`          | Open the panel on mount.                   |
| `position`      | `"bottom-right" \| "bottom-left" \| "top-*"` | `"bottom-right"` | Corner the toggle anchors to.              |
| `disabled`      | `boolean`                                    | `false`          | Render nothing at all.                     |

`store` / `stores` are typed `unknown` to avoid coupling the panel to silo's
generic `DocumentStore<M, Q>` — pass your store directly; non-silo values are
ignored.

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
import { getSiloDevtools, snapshotSilo, siloActivity, serialize } from "@supergrain/devtools";

const bridge = getSiloDevtools(store); // undefined if it isn't a silo store
if (bridge) {
  const snap = snapshotSilo(bridge); // { documents, queries, totals }
  const activity = siloActivity(bridge); // { fetching, errored }
}
// Run inside a kernel effect()/tracked() scope to subscribe to changes.
```

- `getSiloDevtools(store)` — the one boundary that turns a store into an
  inspectable `bridge` (or `undefined`).
- `snapshotSilo(bridge, options?)` — a plain snapshot of the cache. Pass
  `includeValue` to serialize the value/error of selected entries only.
- `siloActivity(bridge)` — cheap fetching/errored counts for an indicator.
- `serialize(value, options?)` — turn an arbitrary (possibly reactive,
  possibly cyclic) value into a depth/breadth-capped `JsonNode` tree.
