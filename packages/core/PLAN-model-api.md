# Plan: Vite Compiler Plugin for `createStore`

## Summary

Add a Vite plugin that compiles property reads on store objects into direct signal access, eliminating proxy overhead on reads. `createStore` returns a `Branded<T>` type — a recursive phantom marker that lets the plugin identify store objects anywhere in the component tree. No new packages, no schema library dependency.

Compiled reads beat solid-js/store in every benchmark scenario while maintaining a natural `store.property` developer experience and proxy fallback for dynamic access.

### Benchmark Evidence

| Scenario | Compiled | Proxy (current) | solid-js/store | vs solid | vs current |
|----------|------:|------:|------:|:------|:------|
| Component render (8 reads, 1k mutations) | 6,322 | 1,148 | 5,354 | **1.18x faster** | **5.5x faster** |
| Fine-grained (10 components, 1k mutations) | 7,589 | 2,663 | 5,061 | **1.50x faster** | **2.9x faster** |
| Batched (5 props, 1k batches) | 1,269 | 734 | 917 | **1.38x faster** | **1.7x faster** |
| Deep updates (100 nested) | 61,426 | 13,524 | 19,951 | **3.08x faster** | **4.5x faster** |

Benchmark files: `prototype/direct-signal-reads.bench.ts`, `prototype/direct-signal-correctness.test.ts`

## Architecture

```
createStore<T>(data)   ← returns Branded<T> (recursive phantom type)
     │
     ├─► Proxy-wrapped store (runtime — same as today)
     │
     └─► Branded<T> type (compile-time — $BRAND on all nested objects)
              │
              ▼
         Vite Plugin   ← one rule: PropertyAccessExpression on branded type
              │
              ├─ BRANDED:   x.prop    → readSignal(x, 'prop')()
              └─ UNBRANDED: left alone (proxy handles it)
```

```ts
type Branded<T> = T extends object
  ? { [K in keyof T]: Branded<T[K]> } & { readonly [$BRAND]: true }
  : T
```

The brand is a phantom type — no `$BRAND` property exists at runtime. It's a type-level contract: "this came from `createStore` and has proxy infrastructure." Only `createStore` returns `Branded<T>`, so the plugin only compiles reads on actual store objects.

**`readSignal(target, prop)`** — runtime helper in core:
```ts
function readSignal(target, prop) {
  const raw = unwrap(target)
  const nodes = raw[$NODE] || (Object.defineProperty(raw, $NODE, { value: {} }), raw[$NODE])
  return nodes[prop] || (nodes[prop] = signal(raw[prop]))
}
```

Accepts proxies or raw objects (calls `unwrap()` internally). Creates signals lazily on `$NODE` — the same node map core's proxy uses. Compiled reads and proxy reads share the same signals. Direct signal reads (not `computed()` wrappers) because computed re-evaluates through the proxy on each mutation — benchmarks went from 2x behind solid-js to 1.2-3x ahead.

The plugin doesn't care HOW a variable got its branded type — function parameter, loop variable, destructured binding, callback argument, import. It asks one question: does this variable's resolved type have `$BRAND`?

```ts
store.title                              → readSignal(store, 'title')()
store.assignee.name                      → readSignal(store.assignee, 'name')()
function TaskCard({ a }: Props) { a.name → readSignal(a, 'name')() }
store.comments.map(c => c.text           → readSignal(c, 'text')())
for (const c of store.comments) { c.text → readSignal(c, 'text')() }
const [first] = store.comments; first.text → readSignal(first, 'text')()
```

### Why writes don't need compilation

The proxy `set` trap is just `setProperty(target, prop, value)` — one function call, no parsing. Direct assignment (`store.title = 'x'`) goes through the proxy `set` trap where `target` is the raw object (Proxy provides it) — equivalent performance, one trap dispatch. The `update()` function handles dynamic operations streaming from the network (`$set`, `$push`, `$pull`, etc.) where operations aren't known at compile time.

### React compatibility

Compiled reads (`readSignal(x, 'prop')()`) check `getCurrentSub()` when invoking the signal. In React, `useTracked` sets `currentSub` once and returns the branded value — no tracking proxy needed.

```ts
export function useTracked<T>(value: T): T {
  // ... setup effect, get effectNode ...
  setCurrentSub(effectNode)
  return value  // branded — plugin compiles reads
}
```

**Every component that reads store properties must call `useTracked`.** This is explicit opt-in — components that don't need reactivity don't create unnecessary effect nodes (memory/CPU). The plugin auto-inserts `useTracked` for components with branded props:

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

The plugin detects React components with branded parameters and auto-inserts `useTracked` — no boilerplate for child components. A lint rule catches edge cases the plugin misses.

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

// Write (direct assignment — proxy set trap, no compilation needed)
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
  return <div>{member.name}</div>  // branded — compiled
}
```

**React usage:**
```tsx
function TodoPage() {
  const store = useTracked(todoStore)  // sets subscriber, returns branded store
  return <div>{store.title}</div>           // compiled read, tracked to this component
}
```

**Vite config:**
```ts
import { supergrain } from '@supergrain/vite-plugin'
export default { plugins: [supergrain()] }
```

## Implementation

Red/green TDD — tests first, then implementation.

### 1. `Branded<T>` return type on `createStore`

1. **Tests**: Type-level tests verifying `createStore` return type has `$BRAND` at all nesting levels. Tests fail.
2. **Implementation**: Add `Branded<T>` mapped type, update `createStore` return type. Tests pass.

### 2. `readSignal()` in core

1. **Tests**: Convert prototype correctness tests to use `readSignal()` (which doesn't exist yet). Tests fail.
2. **Implementation**: One new export in `@supergrain/core`. Must use the same `signal()` import as core (shared reactive graph). Tests pass.

### 3. `@supergrain/vite-plugin` package

1. **Tests**: Snapshot tests (input TS → expected compiled output), integration tests (compile → execute → verify reactivity), negative tests (unbranded objects not compiled), auto-insertion tests (components with branded props get `useTracked` inserted). Tests fail.
2. **Implementation**: TypeScript type checker (incremental) identifies `$BRAND` on types. One AST rewrite rule: branded `PropertyAccessExpression` → `readSignal(expr, 'prop')()`. Auto-inserts `import { readSignal } from '@supergrain/core'` when rewrites occur. Detects React components with branded parameters and auto-inserts `useTracked` calls. MagicString for source-mapped edits. Tests pass.

### 4. Simplify `useTracked`

1. **Tests**: Existing React integration tests should continue passing after removing the tracking proxy.
2. **Implementation**: Replace the tracking proxy with `setCurrentSub(effectNode)` + return branded store directly. Works with both top-level stores and nested objects.

### 5. Lint rule

ESLint rule: if a component reads a property on a `Branded<T>` type without calling `useTracked`, flag it. Same enforcement pattern as React's rules-of-hooks.

## Testing

Same tests, same benchmarks — parameterized by creation path. The model is `createStore` with a branded type cast, so reactive behavior is identical. Tests validate the model doesn't break anything; benchmarks confirm zero overhead.

```ts
// Current prototype test (inline helpers):
it('effect fires when property changes', () => {
  const [store] = createStore({ title: 'Buy milk' })
  const raw = unwrap(store) as any
  const titleSignal = getNode(getNodes(raw), 'title', raw.title)
  // ...
})

// Converted to use readSignal:
it('effect fires when property changes', () => {
  const [store] = createStore({ title: 'Buy milk' })
  const raw = unwrap(store) as any
  const titleSignal = readSignal(raw, 'title')
  // ... same test body
})
```

Compilation correctness (that branded types produce the right `readSignal()` rewrites) is covered by the Vite plugin's snapshot tests: input TS → expected compiled output. These are type-level properties, not runtime behavior.

## Non-Goals (this phase)

- Non-Vite bundler plugins
- Devtools integration
- Backwards compatibility with older Vite versions
