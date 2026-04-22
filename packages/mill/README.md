# @supergrain/mill

MongoDB-style update operators for Supergrain stores. Write batched, path-aware updates with the familiar `$set`, `$inc`, `$push`, `$pull`, `$addToSet`, `$min`, `$max`, `$unset` vocabulary.

Use this when you want:

- A single call to apply several updates atomically (all operators inside one `update()` run under one `batch()`)
- Dot-notation paths for nested writes (`"user.address.city"`)
- Semantics that mirror MongoDB's update operators so the behavior is predictable

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
  lowestScore: 100,
  highestScore: 50,
});

// $set — set values (supports dot notation for nested paths)
update(store, { $set: { count: 10, "user.name": "Alice" } });

// $unset — remove fields
update(store, { $unset: { "user.middleName": 1 } });

// $inc — increment/decrement numbers
update(store, { $inc: { count: 1 } });
update(store, { $inc: { count: -5 } });

// $push — add to arrays (with $each for multiple)
update(store, { $push: { items: "d" } });
update(store, { $push: { items: { $each: ["e", "f"] } } });

// $pull — remove from arrays
update(store, { $pull: { items: "b" } });

// $addToSet — add only if not already present
update(store, { $addToSet: { tags: "vue" } });

// $min / $max — conditional updates
update(store, { $min: { lowestScore: 50 } });
update(store, { $max: { highestScore: 100 } });

// Batching — multiple operators in one call
update(store, {
  $set: { "user.name": "Bob" },
  $inc: { count: 2 },
  $push: { items: "g" },
});
```

Every `update()` call runs under one `batch()`, so subscribers fire once even when multiple operators land together.

## Operators

| Operator    | Behavior                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------- |
| `$set`      | Assigns values at one or more paths. Dot notation writes into nested objects.             |
| `$unset`    | Deletes the property at each path. Value (`1`, `true`) is ignored — presence triggers it. |
| `$inc`      | Adds a numeric delta to each target. Negative values decrement.                           |
| `$push`     | Appends to an array. Use `{ $each: [...] }` to append multiple items in one operation.    |
| `$pull`     | Removes every occurrence of the value from the target array.                              |
| `$addToSet` | Appends only if the value isn't already in the array (shallow equality).                  |
| `$min`      | Assigns the operand only if it's less than the current value.                             |
| `$max`      | Assigns the operand only if it's greater than the current value.                          |

## Path typing

Path autocompletion and type checking work up to 5 levels of nesting. Beyond that, paths fall through to a permissive `Record<string, unknown>` type. This limit exists because TypeScript's conditional-type recursion gets very expensive past depth 5; raising it would significantly slow type-checking for downstream consumers.

## License

MIT
