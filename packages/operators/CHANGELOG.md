# @supergrain/operators

## 3.1.0

### Minor Changes

- Make `UpdateOperations<T>` strict — per-path value typing is now enforced.

  **Breaking change (type-level only — no runtime change):**

  `UpdateOperations<T>` was previously a union of `LooseUpdateOperations | StrictUpdateOperations<T>`. Because TypeScript only requires one side of a union to match, the loose half silently disabled per-operator path/value typing for every caller — making `StrictUpdateOperations<T>` effectively decorative.

  As of 3.1.0 there is no escape hatch:

  - `LooseUpdateOperations` has been **removed entirely** (no longer exported).
  - `UpdateOperations<T>` aliases `StrictUpdateOperations<T>` directly.
  - The path operation helpers (`SetPathOperations`, `UnsetPathOperations`, `NumericPathOperations`, `ArrayWriteOperations`, `ArrayPullOperations`) are now plain mapped types over `Path<T>` / `NumericPath<T>` / `ArrayPath<T>`, with no `& Record<string, unknown>` intersection.

  ```ts
  // Before — loose escape hatch silently disabled per-path checking
  export type UpdateOperations<T extends object = Record<string, any>> =
    | LooseUpdateOperations
    | StrictUpdateOperations<T>;

  // After — strict only
  export type UpdateOperations<T extends object = Record<string, any>> = StrictUpdateOperations<T>;
  ```

  Per-path *value* typing is now enforced too: `$set: { "user.name": 42 }` is rejected when `user.name: string`.

  **Migration:**

  - For `Record<string, X>` consumers (e.g. document caches keyed by id), `Path<T>` already covers the `${prefix}.${string}` patterns those produce — strict typing accepts them without any cast. If your dynamic key happens to widen to plain `string` at the use site (TS infers `[x: string]: V` for computed property names whose interpolations are `string`), prefer direct mutation against the reactive proxy, which fires the same signals as `update({ $set })` without going through a path string:

    ```ts
    // Instead of
    update(store, { $set: { [`documents.${type}.${id}`]: doc } });

    // Direct mutation (typesafe, equivalent reactivity)
    store.documents[type] ??= {};
    store.documents[type][id] = doc;
    ```

  - For paths past the recursion-depth limit on `Path<T>` (default `D = 5`), cast the operations object to `any` at the call site, or pass an explicit deeper depth via `Path<MyShape, 7>` if you really need autocomplete that deep. Casts to `any` are still local — they don't infect the rest of the type checking.

### Patch Changes

- Document the recursion-depth limit on `Path<T>` (default `D = 5`). Paths deeper than the limit are simply absent from the union `Path<T>` resolves to — strict path operation maps will reject them. Consumers that need deeper paths must pass an explicit `D`. Raising `D` significantly increases compile time at every consumer call site, so the default trades autocomplete depth for compile speed.

## 3.0.0

### Major Changes

- de3b0c4: Extract MongoDB-style update operators into a new package, `@supergrain/operators`.

  **Breaking change:**

  `update`, `UpdateOperations`, `LooseUpdateOperations`, and `StrictUpdateOperations` are no longer exported from `@supergrain/core`. Install `@supergrain/operators` and import them from there.

  **Migration:**

  ```ts
  import { createReactive, update } from "@supergrain/core";

  import { createReactive } from "@supergrain/core";
  import { update } from "@supergrain/operators";
  ```

  **Why:** Update operators are convenience sugar built on top of the proxy primitive. Splitting them out keeps `@supergrain/core` focused on the reactive primitive and lets apps that only use direct mutation skip the extra bytes.

### Patch Changes

- Updated dependencies [de3b0c4]
- Updated dependencies [3dc7b57]
  - @supergrain/core@3.0.0
