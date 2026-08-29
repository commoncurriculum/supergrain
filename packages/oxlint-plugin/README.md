# @supergrain/oxlint-plugin

Lint rules that catch supergrain code which compiles, renders, and is silently
non-reactive.

Install it in the apps that **use** supergrain, alongside the
[`supergrain` skill](https://github.com/commoncurriculum/supergrain/tree/main/skills).
The skill teaches an agent what to write; these rules catch what still goes
wrong.

## What this is for

There are three things that can tell you supergrain code is wrong, and they
cover different ground:

- **TypeScript** catches everything visible in a type — `update()` arity,
  calling `undo` as if it were a function, importing `useDocument` from
  `@supergrain/silo/react` instead of from `createDocumentStoreContext()`.
  These rules deliberately don't duplicate that; `tsc` reports it better.
- **The skill** shapes what gets written in the first place, but it is
  advisory: it only applies when it's loaded, and it can be forgotten mid-file.
- **These rules** cover the gap between them — code that type-checks, runs, and
  never updates. No error, no exception, no failing test. The UI just goes
  stale.

That last category is small, and every rule here is in it.

## Install

```bash
pnpm add -D @supergrain/oxlint-plugin
```

```jsonc
// .oxlintrc.json
{
  "jsPlugins": ["@supergrain/oxlint-plugin"],
  "rules": {
    "supergrain/require-tracked": "error",
    "supergrain/no-async-batch": "error",
  },
}
```

The API is ESLint v9 compatible, so the same package works as an ESLint plugin
if that's what a project uses.

### Also worth setting

The blanket ban on the two hooks needs no plugin — oxlint's built-in
`no-restricted-imports` does it, and a message naming the replacement is more
useful than a bare rejection:

```jsonc
"no-restricted-imports": ["error", { "paths": [{
  "name": "react",
  "importNames": ["useState", "useEffect"],
  "message": "useReactive/createStoreContext for state; useReactivePromise/useResource/useReactiveTask/modifier/useSignalEffect for effects."
}]}]
```

## Rules

### `require-tracked`

A component not wrapped in `tracked()` subscribes to nothing of its own. It
still re-renders when a parent does, which is what makes this dangerous: it
usually looks fine, until the parent stops re-rendering and the child quietly
shows stale data.

```tsx
// ✗ silently stale — subscribes to nothing
function Row({ todo }) {
  return <li>{todo.title}</li>;
}

// ✓
const Row = tracked(({ todo }) => <li>{todo.title}</li>);
```

Every component is flagged by default, not just ones provably reading reactive
state — proving that needs type information a linter doesn't have, and a miss
here is a silent bug, while a needless wrapper costs nothing.

| Option         | Default | Effect                                                                                               |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `onlyReactive` | `false` | Only flag components calling a known reactive hook. Quieter, but misses reactivity arriving by prop. |
| `storeHooks`   | `[]`    | Extra hook names that read reactive state, for `onlyReactive`.                                       |

`storeHooks` exists because `createStoreContext()` returns a hook you name
yourself, usually in another module:

```jsonc
"supergrain/require-tracked": ["error", { "onlyReactive": true, "storeHooks": ["useStore", "useSession"] }]
```

### `no-async-batch`

`batch()` is synchronous and throws on a returned Promise. TypeScript won't stop
you, because it allows a Promise-returning function wherever a `() => void` one
is expected.

```tsx
// ✗ throws at runtime
batch(async () => {
  store.a = await load();
});

// ✓ await first, then batch the synchronous writes
const data = await load();
batch(() => {
  store.a = data.a;
  store.b = data.b;
});
```

## Known limits

- **No type information.** Rules identify supergrain values by tracking imports
  and bindings, not types. A value reaching a rule through a helper in another
  module is not followed. This is also why there is no rule about props: a prop
  that _is_ a store object stays fully reactive, a scalar prop does not, and
  without types those are indistinguishable — so a rule there would flag the
  library's central idiom as a bug.
- **Named imports only.** `import { batch }` and `import { batch as b }` both
  resolve; `import * as sg` then `sg.batch(...)` does not.
- **Component detection follows React's own convention** — a capitalised name
  that renders JSX. A component assigned to a lowercase name is not seen.

## Development

```bash
pnpm test        # builds dist, then runs unit + integration tests
pnpm typecheck
```

Rules are unit-tested with oxlint's `RuleTester`. `tests/integration.test.ts`
additionally runs the real oxlint binary over a fixture, because a plugin that
fails to register reports nothing at all — which no unit test would notice.
