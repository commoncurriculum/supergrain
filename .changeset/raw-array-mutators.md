---
"@supergrain/kernel": patch
---

Array mutators (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`) on reactive arrays now run on the underlying array and notify subscribers once, instead of routing every element read and write through the proxy. `push` is about 3.7x faster with a subscriber, and removing a row in a React list uses about 44% less JS. Whole-array iteration methods (`map`, `forEach`, `filter`, `flatMap`, `reduce`, `reduceRight`) also run on the underlying array with one subscription to the array instead of one per index: a tracked `map` over 1,000 rows is about 2.6x faster. Also fixes a stale read: after `splice` or `pop` shortens an array, a subscriber reading an index past the new end now sees `undefined` instead of the removed element.
