---
"@supergrain/silo": minor
---

**New: `store.findAllInMemory(type)`.** Every loaded document of a type, as one reactive array. It grows as documents load and empties on `clearMemory()`. Pass it to `computedList` to query everything you have loaded, and the query follows each new document without scanning the list again:

```ts
const openTasks = computedList(() => store.findAllInMemory("task"))
  .filter((task) => !task.attributes.done)
  .orderBy((task) => task.attributes.dueAt);
```
