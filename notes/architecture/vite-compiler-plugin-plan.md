# Vite Compiler Plugin for `createStore`

> **Status: Partially implemented, core approach abandoned.**
>
> - `Branded<T>` type: DONE (in `@supergrain/core`)
> - Vite plugin scaffold: DONE (in `@supergrain/vite-plugin`)
> - `readSignal` compilation: ABANDONED -- proven slower than proxy (see [compiled-reads-investigation.md](../research/compiled-reads-investigation.md))
> - What actually shipped: `createView()` prototype getters + `$$()` direct DOM bindings
>
> **TL;DR:** Attempted to compile `store.prop` reads into direct `readSignal()` calls to bypass proxy overhead. Early prototype benchmarks looked promising (1.2-3x faster than solid-js/store), but those numbers came from a flat signal map architecture. The per-level `readSignal` approach that this plan describes does NOT achieve those numbers. Proxy reads turned out to be fast enough.

## Goal

Eliminate proxy overhead on reads by compiling property access on store objects into direct signal access at build time, while preserving the natural `store.property` DX and falling back to proxy for dynamic access.

## Benchmark Data (Early Prototype -- Superseded)

These numbers were from an early prototype with a different architecture (flat signal maps, pre-allocated). They do NOT represent the per-level `readSignal` approach described in this plan.

| Scenario | Compiled | Proxy (current) | solid-js/store | vs solid | vs current |
|---|---:|---:|---:|:---|:---|
| Component render (8 reads, 1k mutations) | 6,322 | 1,148 | 5,354 | 1.18x faster | 5.5x faster |
| Fine-grained (10 components, 1k mutations) | 7,589 | 2,663 | 5,061 | 1.50x faster | 2.9x faster |
| Batched (5 props, 1k batches) | 1,269 | 734 | 917 | 1.38x faster | 1.7x faster |
| Deep updates (100 nested) | 61,426 | 13,524 | 19,951 | 3.08x faster | 4.5x faster |

Benchmark files: `prototype/direct-signal-reads.bench.ts`, `prototype/direct-signal-correctness.test.ts`

## Architecture

```
createStore<T>(data)   -- returns Branded<T> (recursive phantom type)
     |
     +-> Proxy-wrapped store (runtime -- same as today)
     |
     +-> Branded<T> type (compile-time -- $BRAND on all nested objects)
              |
              v
         Vite Plugin   -- one rule: PropertyAccessExpression on branded type
              |
              +- BRANDED:   x.prop    -> readSignal(x, 'prop')()
              +- UNBRANDED: left alone (proxy handles it)
```

### Branded<T> Type

```ts
type Branded<T> = T extends object
  ? { [K in keyof T]: Branded<T[K]> } & { readonly [$BRAND]: true }
  : T
```

The brand is a phantom type -- no `$BRAND` property exists at runtime. Only `createStore` returns `Branded<T>`, so the plugin only compiles reads on actual store objects.

### readSignal() Runtime Helper

```ts
function readSignal(target, prop) {
  const raw = unwrap(target)
  const nodes = raw[$NODE] || (Object.defineProperty(raw, $NODE, { value: {} }), raw[$NODE])
  return nodes[prop] || (nodes[prop] = signal(raw[prop]))
}
```

Accepts proxies or raw objects (calls `unwrap()` internally). Creates signals lazily on `$NODE` -- the same node map core's proxy uses. Compiled reads and proxy reads share the same signals.

### Compilation Examples

```ts
store.title                              -> readSignal(store, 'title')()
store.assignee.name                      -> readSignal(store.assignee, 'name')()
function TaskCard({ a }: Props) { a.name -> readSignal(a, 'name')() }
store.comments.map(c => c.text           -> readSignal(c, 'text')())
for (const c of store.comments) { c.text -> readSignal(c, 'text')() }
const [first] = store.comments; first.text -> readSignal(first, 'text')()
```

The plugin doesn't care HOW a variable got its branded type -- function parameter, loop variable, destructured binding, callback argument, import. It asks one question: does this variable's resolved type have `$BRAND`?

### Why Writes Don't Need Compilation

The proxy `set` trap is `setProperty(target, prop, value)` -- one function call, no parsing. Direct assignment (`store.title = 'x'`) goes through the proxy `set` trap where `target` is the raw object -- equivalent performance. The `update()` function handles dynamic operations (`$set`, `$push`, `$pull`, etc.) where operations aren't known at compile time.

## React Compatibility

Compiled reads (`readSignal(x, 'prop')()`) check `getCurrentSub()` when invoking the signal. In React, `useTracked` sets `currentSub` once and returns the branded value:

```ts
export function useTracked<T>(value: T): T {
  // ... setup effect, get effectNode ...
  setCurrentSub(effectNode)
  return value  // branded -- plugin compiles reads
}
```

**Every component reading store properties must call `useTracked`.** The plugin auto-inserts it for components with branded props:

```tsx
// You write:
function TodoItem({ item }: { item: Store['items'][0] }) {
  return <div>{item.title}</div>
}

// Plugin emits:
function TodoItem({ item }: { item: Store['items'][0] }) {
  item = useTracked(item)
  return <div>{readSignal(item, 'title')()}</div>
}
```

For top-level store access, you call `useTracked` manually:

```tsx
function TodoList() {
  const store = useTracked(todoStore)
  return store.items.map(item => <TodoItem item={item} />)
}
```

## API

```ts
import { createStore } from '@supergrain/core'

const [store, update] = createStore({
  id: 1, title: 'Buy milk', completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery'],
})

// Read (compiled by plugin)
store.title
store.assignee.name

// Write (direct assignment -- proxy set trap, no compilation needed)
store.title = 'Get oats'

// Write (dynamic operations from network)
update({ $set: { title: 'Get oats' } })
update({ $push: { tags: 'health' } })
```

**With existing TypeScript interfaces:**
```ts
const data: CardStackAttributes = await fetch('/api/card-stack').then(r => r.json())
const [store, update] = createStore(data)

store.cards[0].attributes.title          // compiled at every level
store.reviews[0].status                  // compiled
```

**Branded types flow through components:**
```tsx
type Store = typeof store
type Member = Store['organization']['departments'][0]['teams'][0]['members'][0]

function MemberCard({ member }: { member: Member }) {
  return <div>{member.name}</div>  // branded -- compiled
}
```

**Vite config:**
```ts
import { supergrain } from '@supergrain/vite-plugin'
export default { plugins: [supergrain()] }
```

## Implementation Plan (Red/Green TDD)

### 1. `Branded<T>` return type on `createStore`
- Type-level tests verifying `$BRAND` at all nesting levels
- Add `Branded<T>` mapped type, update `createStore` return type

### 2. `readSignal()` in core
- Convert prototype correctness tests to use `readSignal()`
- One new export in `@supergrain/core`, sharing the same `signal()` import (shared reactive graph)

### 3. `@supergrain/vite-plugin` package
- Snapshot tests (input TS -> expected compiled output)
- Integration tests (compile -> execute -> verify reactivity)
- Negative tests (unbranded objects not compiled)
- Auto-insertion tests (components with branded props get `useTracked`)
- TypeScript type checker (incremental) identifies `$BRAND` on types
- One AST rewrite rule: branded `PropertyAccessExpression` -> `readSignal(expr, 'prop')()`
- Auto-inserts `import { readSignal } from '@supergrain/core'`
- Detects React components with branded parameters, auto-inserts `useTracked`
- MagicString for source-mapped edits

### 4. Simplify `useTracked`
- Replace tracking proxy with `setCurrentSub(effectNode)` + return branded store directly

### 5. Lint rule
- ESLint rule: flag branded property reads without `useTracked` (same enforcement pattern as rules-of-hooks)

## Testing Strategy

Same tests, same benchmarks -- parameterized by creation path. Reactive behavior is identical; tests validate correctness, benchmarks confirm zero overhead.

```ts
// Converted to use readSignal:
it('effect fires when property changes', () => {
  const [store] = createStore({ title: 'Buy milk' })
  const raw = unwrap(store) as any
  const titleSignal = readSignal(raw, 'title')
  // ... same test body
})
```

Compilation correctness (branded types -> correct `readSignal()` rewrites) is covered by snapshot tests: input TS -> expected compiled output.

## Non-Goals (This Phase)

- Non-Vite bundler plugins
- Devtools integration
- Backwards compatibility with older Vite versions

## Key Learnings

1. **Microbenchmark results didn't transfer.** The early prototype's flat signal map architecture gave impressive numbers, but the production-viable per-level `readSignal` approach was slower than proxy reads.
2. **Proxy overhead is not the bottleneck it appears.** V8 optimizes proxy traps well enough that the function call overhead of `readSignal()` + `unwrap()` negates the savings.
3. **What worked instead:** `createView()` with prototype getters and `$$()` direct DOM bindings -- approaches that avoid per-access function calls entirely.
