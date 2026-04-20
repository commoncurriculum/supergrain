# @supergrain/operators

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
