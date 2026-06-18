# REJECTED: Using mingo for mill's update operators

> **STATUS: REJECTED.** We considered backing `@supergrain/mill`'s update
> operators with [mingo](https://github.com/kofrasa/mingo) (a MongoDB
> query/update engine for plain JS objects) and decided against it. mingo
> mutates plain data and never touches the kernel's signal layer, so it would
> force a diff/reconcile pass and give up fine-grained reactivity, per-path type
> safety, and bundle size. mill hand-rolls a small set of operators on top of
> the kernel's own write primitives instead.

**Date:** June 2026

## Context

`@supergrain/mill` provides MongoDB-style update operators (`$set`, `$unset`,
`$inc`, `$min`, `$max`, `$push`, `$pull`, `$pullAll`, `$addToSet`, `$rename`)
that apply to a reactive store. mingo already implements the MongoDB query +
update language in JavaScript, so the natural question is: why not just delegate
to it?

## Why we are NOT using mingo

1. **It doesn't drive our signals — this is the deciding reason.** Supergrain's
   reactivity comes entirely from the kernel's proxy/signal layer. mingo applies
   updates to the plain underlying object without notifying any signal. To make
   the UI react we'd then have to diff the before/after state and replay the
   changes into signals — the exact reconciliation pass we work to avoid. mill's
   operators instead call the kernel write primitives (`setProperty` /
   `deleteProperty`) as they mutate, so the right signals fire inline with no
   reconcile step.

2. **No fine-grained control.** We want precise signal behavior — e.g. removing
   one array element should fire only the affected indices and `length`, not
   invalidate the whole array; a nested `$set` should touch only the written
   leaf. That requires owning the mutation loop. A general engine that produces
   a new document (or mutates opaquely) can't express that granularity.

3. **Per-path type safety.** mill's operators are strictly typed against the
   store shape `T` (`Path<T>` / `PathValue<T, P>`), so `$set: { "user.name": 42 }`
   is a compile error when `user.name` is a `string`. mingo operates on loosely
   typed `any` documents; adopting it would forfeit that checking.

4. **Bundle size / surface area.** mingo is a full Mongo query + aggregation +
   update engine. mill needs a small, fixed subset of update operators. Pulling
   in the whole engine is bytes and API we don't ship.

5. **Ownership of semantics.** Keeping the operators in-house means we control
   edge cases (deep-equality matching, `$each`, `$pull` vs `$pullAll`, rename
   conflicts) and have no external runtime dependency in a core code path.

## What we do instead

A compact dispatcher in `operators.ts` maps each operator to a function that
mutates the (unwrapped) target through the kernel's write primitives, all inside
a single `batch()`. No external dependency, no reconciliation.

## If we ever want broader Mongo compatibility

Add more operators to `operators.ts` the same way — each one calling the kernel
primitives — rather than delegating mutation to a library that bypasses the
signal layer.
