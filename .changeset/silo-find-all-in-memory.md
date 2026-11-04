---
"@supergrain/silo": minor
---

Add `store.findAllInMemory(type)`: every loaded document of a type, in first-load order, as one reactive array that grows as documents load and empties on `clearMemory()`. Pass it to `computedList` to filter, sort or look things up across what's loaded; the list follows each insert without rescanning.
