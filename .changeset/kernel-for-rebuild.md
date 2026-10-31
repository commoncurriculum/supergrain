---
"@supergrain/kernel": patch
---

`<For>` shows every change to which items are where, and keeps rows that only moved.

- With `parent`, replacing an item without changing the array's length (`store.data[1] = next`) now updates the DOM. Before, only an exact two-item swap was handled, and any other same-length change left the DOM stale. Two slots replaced by new items are no longer mistaken for a swap.
- Without `parent`, rows are keyed by item and given the item directly. When items shift up a slot (one leaves the top of a sorted list), the rows that only moved no longer re-render. A row whose `children` takes the index still re-renders when its index changes.
- `<For>` follows the array with one signal for in-place replacements instead of one subscription per index.
- `each` accepts a `ReadonlyArray`, so a `computedList` result can be passed without a cast: `<For each={openTasks()}>`.
