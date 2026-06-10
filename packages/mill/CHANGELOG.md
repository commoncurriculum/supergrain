# @supergrain/mill

## 5.0.0

### Patch Changes

- 82cf6a6: Upgrade the reactive core from `alien-signals` 2.0.7 to 3.2.1.

  **Breaking — `effect` cleanup semantics.** `effect(fn)` (re-exported from `@supergrain/kernel`, and the engine behind `useSignalEffect`) now treats `fn`'s return value as a **cleanup function**: it runs before each re-run and once on dispose, matching React's `useEffect` mental model. A callback that returns a non-function value will throw `"cleanup is not a function"` on its next run — so read signals for subscription with a statement body or `void`:

  ```ts
  effect(() => void store.count); // subscribe-only, no cleanup
  effect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id); // cleanup
  });
  ```

  `useSignalEffect(fn)` now accepts `fn: () => void | (() => void)` and wires that cleanup to the component lifecycle.

  **Internal rename.** alien-signals renamed `getCurrentSub`/`setCurrentSub` to `getActiveSub`/`setActiveSub`; `@supergrain/kernel/internal` now re-exports the new names. `ReactiveNode` is imported from `alien-signals/system`. No change to the public package-root API (these primitives were never exported from it).

  All reactive semantics (fine-grained tracking, batching, Map/Set notification coalescing) are unchanged — verified across the kernel, mill, husk, and silo test suites.

- Updated dependencies [82cf6a6]
- Updated dependencies [b61db1b]
- Updated dependencies [d4a918b]
  - @supergrain/kernel@5.0.0

## 4.0.0

### Major Changes

- 6065b78: Extract MongoDB-style update operators into a new package, `@supergrain/mill`.

  **Breaking change (kernel):**

  `update`, `UpdateOperations`, `LooseUpdateOperations`, and `StrictUpdateOperations` are no longer exported from `@supergrain/kernel`. Install `@supergrain/mill` and import them from there.

  **Migration:**

  ```ts
  // Before
  import { createReactive, update } from "@supergrain/kernel";

  // After
  import { createReactive } from "@supergrain/kernel";
  import { update } from "@supergrain/mill";
  ```

  **Why:** Update operators are convenience sugar built on top of the proxy primitive. Splitting them out keeps `@supergrain/kernel` focused on the reactive primitive and lets apps that only use direct mutation skip the extra bytes.

- 6065b78: Make `UpdateOperations<T>` strict — per-path value typing is now enforced.

  **Breaking change (type-level only — no runtime change):**

  `UpdateOperations<T>` was previously a union of `LooseUpdateOperations | StrictUpdateOperations<T>`. Because TypeScript only requires one side of a union to match, the loose half silently disabled per-operator path/value typing for every caller — making `StrictUpdateOperations<T>` effectively decorative.

  There is no longer an escape hatch:

  - `LooseUpdateOperations` has been **removed entirely** (no longer exported).
  - `UpdateOperations<T>` aliases `StrictUpdateOperations<T>` directly.
  - The path operation helpers (`SetPathOperations`, `UnsetPathOperations`, `NumericPathOperations`, `ArrayWriteOperations`, `ArrayPullOperations`) are now plain mapped types over `Path<T>` / `NumericPath<T>` / `ArrayPath<T>`, with no `& Record<string, unknown>` intersection.

  ```ts
  // Before — loose escape hatch silently disabled per-path checking
  export type UpdateOperations<T extends object = Record<string, any>> =
    | LooseUpdateOperations
    | StrictUpdateOperations<T>;

  // After — strict only
  export type UpdateOperations<T extends object = Record<string, any>> =
    StrictUpdateOperations<T>;
  ```

  Per-path _value_ typing is now enforced too: `$set: { "user.name": 42 }` is rejected when `user.name: string`.

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

  Also: `Path<T>` recursion-depth limit (default `D = 5`) is now documented. Paths deeper than the limit are simply absent from the union `Path<T>` resolves to — strict path operation maps will reject them. Consumers that need deeper paths must pass an explicit `D`. Raising `D` significantly increases compile time at every consumer call site, so the default trades autocomplete depth for compile speed.

### Patch Changes

- Updated dependencies [6065b78]
- Updated dependencies [6065b78]
- Updated dependencies [6065b78]
  - @supergrain/kernel@4.0.0
