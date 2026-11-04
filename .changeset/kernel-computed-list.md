---
"@supergrain/kernel": minor
---

**New: `computedList`, live queries over your store.** Filter, join, group, sort and page a reactive list, and keep the result up to date at the cost of the rows that changed, not the whole list.

```ts
import { computedList } from "@supergrain/kernel";

const openTasks = computedList(() => store.tasks, { users: () => store.users })
  .filter((task) => !task.completed)
  .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }))
  .orderBy((row) => row.task.priority)
  .limit(10);

openTasks(); // the top 10 open tasks with their owners, always current
```

Before this, the way to write that was `stableComputed(() => tasks.filter(...).sort(...).slice(...))`, which filters and sorts every row again each time one task changes. `computedList` gives each row its own computed and moves only the rows whose result changed. Completing one task in a list of 10,000 goes from about 10 ms to about 0.014 ms.

Measured with the kernel's `computed-list.bench.ts` (Node, 10,000 tasks, one change then a read, one run on one machine, so read the ratios as rough):

| Change                                 | vs `stableComputed` | vs TanStack DB live query |
| -------------------------------------- | ------------------: | ------------------------: |
| Complete a task outside the top 10     |         854x faster |               310x faster |
| Move a task inside the sorted list     |         713x faster |               636x faster |
| Add or remove a task                   |         430x faster |               165x faster |
| Join: add or remove a task             |         368x faster |                 7x faster |
| Join: deactivate a user who owns tasks |          15x faster |               1.3x faster |

What it can do:

- `.filter`, `.map`, `.orderBy`, `.offset` and `.limit`, chained in any order.
- Joins. A step can read other docs from the store, or look them up by key in a list named in `lookups`: `get(key)` for one doc, `getAll(key)` for all of them (one-to-many).
- `.groupBy(key)` puts rows that share a key in one group, and the steps after it run once per group. A change moves one row between groups instead of regrouping everything.
- It costs nothing when a field changes that no step reads.
- Pass it straight to `<For>`: `<For each={openTasks()}>`. Only the rows that changed re-render.
- It is pull-based: no effects, nothing to dispose, and correct inside `batch()`.
