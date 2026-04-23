---
"@supergrain/kernel": major
---

Remove `startBatch`, `endBatch`, `getCurrentSub`, and `setCurrentSub` from the public `@supergrain/kernel` exports. They mutate global state (a batch-depth counter and the active subscriber slot) and leak unsafely on exception.

**Migration:**

Replace `startBatch`/`endBatch` pairs with `batch(fn)`, which wraps the same primitives in a try/finally so the batch depth always unwinds (and rejects async callbacks that would leak):

```ts
// Before
import { startBatch, endBatch } from "@supergrain/kernel";
startBatch();
store.data[0] = "a";
store.data[1] = "b";
endBatch();

// After
import { batch } from "@supergrain/kernel";
batch(() => {
  store.data[0] = "a";
  store.data[1] = "b";
});
```

The raw primitives are still available via the `@supergrain/kernel/internal` subpath for sibling Supergrain packages (`@supergrain/mill`, `@supergrain/kernel/react` itself) that need them. `/internal` is published-but-not-SemVer; third-party consumers should not depend on it.
