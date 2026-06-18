# REJECTED: Using mingo for mill's update operators

> **STATUS: REJECTED.** mingo's array update operators replace the whole array
> rather than mutating elements in place. Assigning a fresh array is a coarse
> update — it invalidates the entire array instead of just the elements that
> changed — which defeats the fine-grained reactivity the store exists to
> provide. mill hand-rolls its operators so each does the minimal in-place
> mutation.

**Date:** June 2026

## Why not mingo: it sets arrays instead of mutating fine-grained

The store's whole value is fine-grained reactivity: a `$push` should wake only
the new index and `length`; a `$pull` only the indices that actually shifted.
mingo applies array operators by building a new array and assigning it back —
one coarse write over the whole array, so every element and structural
subscriber re-runs, not just the changed ones. On a large list that is exactly
the over-invalidation the store is built to avoid.

mill mutates in place with the kernel's write primitives instead:

- `$push` — writes only the appended indices and `length`.
- `$pull` / `$pullAll` — shift survivors down and drop the tail, touching only
  the indices whose value changed.
- `$set` on a nested path — touches only that leaf.

## Broader Mongo compatibility, if we want it

Add more operators to `operators.ts` the same way — each doing the minimal
in-place mutation — not by delegating to a library that rewrites whole arrays.
