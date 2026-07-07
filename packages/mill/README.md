# @supergrain/mill

A MongoDB update engine for in-memory documents. Pass a standard Mongo update document — `$set`, `$inc`, `$push`, `$pull`, the positional `$`, all of it — and mill applies it in place and hands you back an **undo**: itself a standard Mongo update document that reverses the exact changes.

There is **no mill-specific syntax**. Every operator, modifier, query, and undo fragment is plain MongoDB.

Use this when you want:

- To apply real Mongo update statements to a plain object or a `@supergrain/kernel` reactive store
- A single call to apply several operators atomically (one `update()` runs under one `batch()`)
- A reversible write — apply optimistically, keep the `undo`, replay it to roll back

## Install

```bash
pnpm add @supergrain/mill @supergrain/kernel
```

## Usage

```typescript
// [#DOC_TEST_46](../doc-tests/tests/readme-core.test.ts)

import { createReactive } from "@supergrain/kernel";
import { update } from "@supergrain/mill";

const store = createReactive({
  count: 0,
  user: { name: "John", age: 30, middleName: "M" },
  items: ["a", "b", "c"],
  tags: ["react"],
  cards: [
    { id: "card-1", title: "One", done: false },
    { id: "card-2", title: "Two", done: false },
  ],
});

// Apply a standard Mongo update. The second argument is a query used only to
// resolve positional paths — pass {} when the update has none.
const result = update(
  store,
  {},
  {
    $set: { count: 10, "user.name": "Alice" },
    $unset: { "user.middleName": "" },
    $inc: { "user.age": 1 },
    $push: { items: { $each: ["d", "e"] } },
    $addToSet: { tags: "vue" },
  },
);

// `result.doc` is the same store reference back. `result.undo` is a Mongo update
// document that reverses the exact changes that were made.
update(store, {}, result.undo);
// store is back to its original state.

// Positional `$`: the query selects the array element, `$` resolves to its index.
update(store, { cards: { $elemMatch: { id: "card-2" } } }, { $set: { "cards.$.title": "Two!" } });
```

## API

```ts
function update<T extends object>(
  doc: T,
  query: Query<T>,
  operations: UpdateOperations<T>,
  options?: UpdateOptions,
): { doc: T; undo: UpdateOperations<T> };

interface UpdateOptions {
  arrayFilters?: Array<ArrayFilter>;
  allowNullIntermediates?: boolean;
}
```

- **`doc`** — the document to mutate, in place. A reactive store gets fine-grained signal updates; a plain object is mutated just the same. The same reference is returned as `result.doc`.
- **`query`** — a Mongo query, used **only** to resolve positional paths (`items.$.name`). It doesn't need to identify the document — that's already selected. Pass `{}` when there are no positional paths.
- **`operations`** — a standard Mongo update document.
- **`options`** — optional. `arrayFilters` supplies the filters for the `$[<identifier>]` filtered positional operator. `allowNullIntermediates` is described below.
- **returns** `{ doc, undo }` — `undo` is a Mongo update document that, applied to the post-update `doc`, restores the exact prior state.

### `allowNullIntermediates`

By default mill is faithful to MongoDB, which **rejects** writing through a `null`. `$set`-ing `"a.b"` when `a` is `null` throws `Cannot create field 'b' in element {a: null}`, and `$push`-ing onto a `null` field throws `The field 'a' must be an array but is of type null`. (A merely _absent_ intermediate is always fine — Mongo, and mill, create the branch.)

Pass `allowNullIntermediates: true` to instead treat a `null` intermediate or target as if the field were **absent** — a deliberate departure from MongoDB:

```ts
// { attributes: { clipboard: null } }
update(doc, {}, { $set: { "attributes.clipboard.card": "c1" } }, { allowNullIntermediates: true });
// → { attributes: { clipboard: { card: "c1" } } }

// { attributes: { cards: null } }
update(doc, {}, { $push: { "attributes.cards": { id: "x" } } }, { allowNullIntermediates: true });
// → { attributes: { cards: [{ id: "x" }] } }
```

- `$set` / `$inc` / `$mul` / `$min` / `$max` / `$rename` build objects over `null` intermediates.
- `$push` / `$addToSet` create the array when the target (or an intermediate) is `null`.
- `$pull` / `$pullAll` / `$pop` no-op on a `null` target, exactly as they do for a missing field.

A present _scalar_ (e.g. `42`) in the way is still an error — only `null` is treated as absent. The generated `undo` restores the prior `null` exactly.

## Operators

| Operator    | Behavior                                                                                |
| ----------- | --------------------------------------------------------------------------------------- |
| `$set`      | Assigns values at one or more paths. Dot notation writes into nested objects.           |
| `$unset`    | Deletes the property at each path. The operand is ignored (`""` is Mongo's convention). |
| `$inc`      | Adds a numeric delta to each target. A missing field starts from 0.                     |
| `$mul`      | Multiplies each numeric target. A missing field starts from 0.                          |
| `$min`      | Assigns the operand only if it's less than the current value.                           |
| `$max`      | Assigns the operand only if it's greater than the current value.                        |
| `$rename`   | Moves a value from one path to another. Throws if the destination already exists.       |
| `$push`     | Appends to an array. Supports `$each`, `$position`, `$slice`, and `$sort`.              |
| `$pop`      | Removes the last (`1`) or first (`-1`) array element.                                   |
| `$pull`     | Removes every array element matching the condition (value, document, or query).         |
| `$pullAll`  | Removes every element deep-equal to any value in the given array.                       |
| `$addToSet` | Appends only values not already present (deep equality). Supports `$each`.              |

## Positional updates

The query argument resolves MongoDB's positional operators in update paths:

- **`$`** — the first array element the query matches.
- **`$[]`** — every array element.

```ts
// Update the first card whose id is "card-2".
update(doc, { cards: { $elemMatch: { id: "card-2" } } }, { $set: { "cards.$.done": true } });

// Mark every card done.
update(doc, {}, { $set: { "cards.$[].done": true } });
```

The query supports the standard Mongo query operators used to select an element: equality, dotted fields, `$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte`/`$in`/`$nin`/`$exists`/`$not`, `$elemMatch`, and the `$and`/`$or`/`$nor` combinators.

## Undo

`undo` is generated from the changes that were **actually made**:

- A no-op operation contributes nothing to `undo`.
- Previous state is restored exactly, including missing-vs-present: a field that was absent is `$unset`, a field that was present is `$set` back.
- Array inverses use Mongo array operators where one suffices — an append undoes with `$pop`/`$slice`, a `$pop` with `$push`, a contiguous `$pull` with `$push` (`$each`/`$position`). An edit no single array operator can invert (a scattered `$pull`) falls back to `$set`-ing the prior array.

```ts
const { undo } = update(doc, {}, { $push: { items: "x" }, $inc: { count: 1 } });
// undo === { $pop: { items: 1 }, $set: { count: <previous> } }
update(doc, {}, undo); // back to where we started
```

## Path typing

Path autocompletion and type checking work up to 5 levels of nesting. Beyond that, paths fall through to a permissive type. This limit exists because TypeScript's conditional-type recursion gets very expensive past depth 5; raising it would significantly slow type-checking for downstream consumers.

## License

MIT
