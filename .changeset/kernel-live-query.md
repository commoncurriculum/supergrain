---
"@supergrain/kernel": minor
---

Add `liveQuery({ from, where, orderBy, compare, offset, limit })`: a filtered, sorted, windowed view of a reactive collection. Changing a field that `where` or `orderBy` read reruns them for that row only and moves that one row with a binary search, instead of filtering and sorting every row again. Changes to fields they never read cost nothing, as with `stableComputed`.
