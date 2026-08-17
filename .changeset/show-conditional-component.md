---
"@supergrain/kernel": minor
---

Add `<Show>` — a firewalled conditional (if/else) component for `@supergrain/kernel/react`. Pass the condition as a function (`when={() => store.todos.length > 0}`) and Show subscribes to its truthiness behind a computed: changes to the condition's inputs re-render nothing until the result actually flips, and the parent never subscribes at all. `fallback` renders the else branch, and function children `(value) => ...` receive the condition's type-narrowed, non-null value.
