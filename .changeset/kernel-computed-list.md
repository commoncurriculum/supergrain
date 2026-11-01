---
"@supergrain/kernel": minor
---

Add `computedList(source, lookups?)`: a chained, filtered, mapped, sorted, windowed view of a reactive list (`.filter`, `.map`, `.orderBy`, `.offset`, `.limit`). Each row runs its steps in its own computed, so changing a field reruns the steps for the rows that read it and moves only those rows with a binary search, instead of filtering and sorting every row again. Steps can read other docs from the store to join, or look docs up by key in lists named in `lookups`.
