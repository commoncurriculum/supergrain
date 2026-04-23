---
"@supergrain/kernel": major
"@supergrain/mill": major
---

Extract MongoDB-style update operators into a new package, `@supergrain/mill`.

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
