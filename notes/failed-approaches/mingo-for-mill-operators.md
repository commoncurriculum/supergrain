# REJECTED: Using mingo for mill's update operators

> **STATUS: REJECTED.** mill hand-rolls a small, strictly-typed set of update
> operators instead of depending on [mingo](https://github.com/kofrasa/mingo).
> **Reactivity is _not_ the reason** — see the correction below. The decision
> rests on type safety, dependency footprint, and ownership of the operator
> surface.

**Date:** June 2026

## Correction: "mingo would bypass our signals" is false

An earlier draft of this note claimed mingo couldn't be used because it mutates
plain objects without notifying signals, forcing a diff/reconcile pass. **That
is wrong**, and it's contradicted by experiments in this very repo:

- The kernel proxy traps **every** write/delete on the object, regardless of
  which code performs it. If a library mutates a document **in place** through
  the **proxy** (not the unwrapped raw object), its `obj.x = …` / `delete` /
  array-method calls go through the `set`/`deleteProperty` traps and drive the
  signals — no reconcile step.
- Verified: when mill's operators were temporarily rewritten to mutate through
  the proxy, the reactivity tests passed. The kernel's
  `packages/kernel/tests/write/array-mutation.test.ts` independently proves that
  `splice` / `push` / `pop` / `shift` called on the proxy fire effects.

So mingo, handed the proxy, would react fine (assuming its updater mutates in
place rather than cloning — not separately verified). Reactivity is a non-issue.

## Why we still hand-roll the operators

- **Type safety.** mill's operators are typed against the store shape `T`
  (`Path<T>` / `PathValue<T, P>`), so `$set: { "user.name": 42 }` is a compile
  error when `user.name` is a `string`. mingo operates on loosely typed `any`
  documents and would forfeit that.
- **Dependency footprint / surface area.** mill needs a small, fixed set of
  update operators. mingo is a full MongoDB query + aggregation + update engine;
  adopting it pulls in API and code we don't ship.
- **Ownership of semantics.** Keeping the operators in-house means we control
  edge cases (deep-equality matching, `$each`, `$pull` vs `$pullAll`, rename
  conflicts) with no external runtime dependency in a core path.

## A perf nuance (not about mingo specifically)

mill applies its operators to the **unwrapped** target via the kernel's write
primitives rather than mutating the proxy. That isn't because the proxy "doesn't
work" — it's because navigating the proxy re-reads each path segment (a signal
read per segment), which the kernel's profiler accounting tests pin to zero for
`update()`. Any approach that drove mutations through the proxy — mingo included
— would add that navigation overhead.

## If we ever want broader Mongo compatibility

Add more operators to `operators.ts` the same way, each calling the kernel
primitives.
