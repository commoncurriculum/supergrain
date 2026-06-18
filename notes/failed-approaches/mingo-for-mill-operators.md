# REJECTED: Using mingo for mill's update operators

> **STATUS: REJECTED.** Two reasons, both about reactivity performance. (1) mingo
> applies array operators by replacing the whole array, which coarsely
> invalidates every element/structure subscriber instead of just what changed —
> it can't do fine-grained mutation. (2) To drive our signals at all it would
> have to mutate through the proxy, paying get-trap navigation on every path
> segment. mill hand-rolls its operators precisely to get both: fine-grained
> in-place mutation, applied to the _unwrapped_ target via the kernel's write
> primitives, with no proxy navigation.

**Date:** June 2026

## Reason 1: fine-grained mutation (mingo sets whole arrays)

The store's whole value is fine-grained reactivity: a `$push` should wake only
the new index and `length`; a `$pull` only the indices that actually shifted.
mingo applies array operators by building a new array and assigning it back —
one coarse write over the whole array, so every element and structural
subscriber re-runs, not just the changed ones. On a large list that is exactly
the over-invalidation the store is built to avoid.

mill mutates in place instead:

- `$push` — writes only the appended indices and `length`.
- `$pull` / `$pullAll` — shift survivors down and drop the tail, touching only
  the indices whose value changed.
- `$set` on a nested path — touches only that leaf.

## Reason 2: operate on the unwrapped target, not the proxy

`update()` unwraps the target once (`unwrap(target)`) and applies every operator
to the raw object, calling the kernel's own write primitives (`setProperty` /
`deleteProperty` — the same functions the proxy's `set`/`deleteProperty` traps
call). The correct signals fire either way; the point is what operating on raw
_avoids_:

- Mutating through the proxy re-walks the `get` trap for every path segment
  (`store.a.b.c` is three trap hops, each doing a node lookup and lazily
  creating a child proxy). `update()` runs outside any effect, so none of that
  registers a dependency — it is pure trap overhead and intermediate allocation.
- Operating on raw resolves the path over plain objects and only touches the
  kernel primitives at the actual write site.

mingo can't have it both ways: handed the raw object it drives no signals; handed
the proxy it drives signals but pays the navigation cost on every segment (and
still replaces whole arrays). Owning the mutation loop lets mill drive signals
precisely **and** skip the proxy hop.

## Broader Mongo compatibility, if we want it

Add more operators to `operators.ts` the same way — each doing the minimal
in-place mutation on the unwrapped target — not by delegating to a library that
rewrites whole arrays.
