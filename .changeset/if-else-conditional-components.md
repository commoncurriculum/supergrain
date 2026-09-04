---
"@supergrain/kernel": minor
---

Add `<If>`/`<ElseIf>`/`<Else>` — firewalled conditional components for `@supergrain/kernel/react`, in the spirit of Ember's `{{#if}}`/`{{else if}}`/`{{else}}`. Pass conditions as functions (`when={() => store.todos.length > 0}`) and `If` subscribes to which branch is active behind a computed: changes to the conditions' inputs re-render nothing until a different branch takes over, and the parent never subscribes at all. Chains short-circuit like real if/else if — later conditions aren't evaluated (or even subscribed to) while an earlier one holds. Children wrapped in `<Else>` render while everything is falsy, and a function child `(value) => ...` receives its branch's type-narrowed, non-null condition value.

Also adds `createAnimatedIf(wrap)` — a module-scope factory returning an `<AnimatedIf>` whose branch swaps run through a presence wrapper (e.g. Motion's `<AnimatePresence>`) so exits animate instead of unmounting instantly. Branches reach the wrapper as fragments keyed per branch, the wrapper stays mounted when no branch matches so the last branch can animate out, and the kernel takes no dependency on any animation library.
