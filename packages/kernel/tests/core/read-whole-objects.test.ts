import { computed } from "alien-signals";
import { describe, expect, it } from "vitest";

import { computedList, createReactive, effect } from "../../src";
import { readWholeObjects } from "../../src/read";

describe("readWholeObjects", () => {
  it("reruns on a write to any field of an object it read, and on deletes", () => {
    const state = createReactive<{ a: number; b: number; c?: number }>({ a: 1, b: 2, c: 3 });
    let runs = 0;
    const read = computed(() => readWholeObjects(() => (runs++, state.a)));
    expect(read()).toBe(1);
    state.b = 5; // never read, but the object changed
    expect(read()).toBe(1);
    expect(runs).toBe(2);
    delete state.c;
    read();
    expect(runs).toBe(3);
    state.a = 4;
    expect(read()).toBe(4);
  });

  it("follows nested objects as wholes too", () => {
    const state = createReactive({ task: { owner: { name: "a" } } });
    const read = computed(() => readWholeObjects(() => state.task.owner.name));
    expect(read()).toBe("a");
    state.task.owner.name = "b";
    expect(read()).toBe("b");
    state.task.owner = { name: "c" };
    expect(read()).toBe("c");
  });

  it("tracks array elements per index: replacing one doesn't bump the array's version", () => {
    const state = createReactive({ tags: ["a", "b"] });
    const read = computed(() => readWholeObjects(() => state.tags[0]));
    expect(read()).toBe("a");
    state.tags[0] = "z";
    expect(read()).toBe("z");
  });

  it("leaves computeds read inside it tracking per field", () => {
    const state = createReactive({ a: 1, b: 2 });
    let innerRuns = 0;
    const inner = computed(() => (innerRuns++, state.a));
    const outer = computed(() => readWholeObjects(() => inner()));
    expect(outer()).toBe(1);
    state.b = 3;
    outer();
    expect(innerRuns).toBe(1);
  });

  it("keeps per-field tracking for a field that already has a signal", () => {
    const state = createReactive({ a: 1, b: 2 });
    effect(() => void state.a); // makes `a`'s signal
    let runs = 0;
    const read = computed(() => readWholeObjects(() => (runs++, state.a)));
    read();
    state.b = 3;
    read();
    expect(runs).toBe(1);
    state.a = 2;
    expect(read()).toBe(2);
  });
});

describe("a list without a map reads rows as whole objects", () => {
  it("reruns a row's filter on an unrelated write, but its readers don't rerun", () => {
    const store = createReactive({
      tasks: [
        { id: 1, done: false, title: "a" },
        { id: 2, done: true, title: "b" },
      ],
    });
    let runs = 0;
    const list = computedList(() => store.tasks).filter((task) => (runs++, !task.done));
    let reads = 0;
    let ids: Array<number> = [];
    effect(() => {
      reads++;
      ids = list().map((task) => task.id);
    });
    runs = reads = 0;
    store.tasks[0]!.title = "renamed";
    expect(runs).toBe(1);
    expect(reads).toBe(0);
    store.tasks[1]!.done = false;
    expect(reads).toBe(1);
    expect(ids).toEqual([1, 2]);
  });
});
