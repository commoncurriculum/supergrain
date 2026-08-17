---
"@supergrain/kernel": minor
---

Add `<If>`/`<Else>` — firewalled conditional components for `@supergrain/kernel/react`, in the spirit of Ember's `{{#if}}`/`{{else}}`. Pass the condition as a function (`when={() => store.todos.length > 0}`) and `If` subscribes to its truthiness behind a computed: changes to the condition's inputs re-render nothing until the result actually flips, and the parent never subscribes at all. Children wrapped in `<Else>` render while the condition is falsy, and a function child `(value) => ...` receives the condition's type-narrowed, non-null value.
