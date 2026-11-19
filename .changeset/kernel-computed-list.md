---
"@supergrain/kernel": minor
---

Add `computedList(source, lookups?)`: a chained, filtered, mapped, sorted, windowed view of a reactive list (`.filter`, `.map`, `.groupBy`, `.orderBy`, `.offset`, `.limit`). Each row runs its steps in its own computed, so changing a field reruns the steps for the rows that read it and moves only those rows with a binary search, instead of filtering and sorting every row again. Steps can read other docs from the store to join, or look docs up by key in lists named in `lookups`: `get(key)` for the first doc with a key, `getAll(key)` for all of them (one-to-many). `.groupBy(key)` puts rows that share a key in one group, and the steps after it run once per group; a change moves one row between groups instead of regrouping. Rows with equal sort keys, and unsorted lists, keep source order.
