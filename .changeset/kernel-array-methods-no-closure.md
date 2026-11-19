---
"@supergrain/kernel": patch
---

Reading an array method through the store (`store.items.push`, `map`, `forEach`, `splice`, ...) no longer makes a new function each time. Each method is now one shared function that finds the array from `this`, so it runs on the array it is called on, the same as a native array method. 100 `push` calls now allocate 24.6 KB instead of 36.7 KB.
