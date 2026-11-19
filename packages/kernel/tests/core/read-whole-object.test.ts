import { computed } from "alien-signals";
import { describe, expect, it } from "vitest";

import { computedList, createReactive, effect, unwrap } from "../../src";
import { readWholeObject } from "../../src/read";

describe("readWholeObject", () => {
  it("reruns on a write to any field of the object, and on deletes", () => {
    const state = createReactive<{ a: number; b: number; c?: number }>({ a: 1, b: 2, c: 3 });
    let runs = 0;
    const read = computed(() =>
      readWholeObject(unwrap(state), () => (runs++, state.a), undefined, undefined),
    );
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

  it("tracks other objects, nested ones included, per field", () => {
    const shared = createReactive({ limit: 1, other: 0 });
    const state = createReactive({ owner: { name: "a", age: 1 } });
    let runs = 0;
    const read = computed(() =>
      readWholeObject(
        unwrap(state),
        () => (runs++, `${state.owner.name}:${shared.limit}`),
        undefined,
        undefined,
      ),
    );
    expect(read()).toBe("a:1");
    shared.other = 1;
    state.owner.age = 2;
    read();
    expect(runs).toBe(1);
    state.owner.name = "b";
    shared.limit = 2;
    expect(read()).toBe("b:2");
    state.owner = { name: "c", age: 3 };
    expect(read()).toBe("c:2");
  });

  it("tracks an array per index: replacing an element doesn't bump its version", () => {
    const tags = createReactive(["a", "b"]);
    const read = computed(() => readWholeObject(unwrap(tags), () => tags[0], undefined, undefined));
    expect(read()).toBe("a");
    tags[0] = "z";
    expect(read()).toBe("z");
  });

  it("leaves computeds read inside it tracking per field", () => {
    const state = createReactive({ a: 1, b: 2 });
    let innerRuns = 0;
    const inner = computed(() => (innerRuns++, state.a));
    const outer = computed(() =>
      readWholeObject(unwrap(state), () => inner(), undefined, undefined),
    );
    expect(outer()).toBe(1);
    state.b = 3;
    outer();
    expect(innerRuns).toBe(1);
  });

  it("keeps per-field tracking for a field that already has a signal", () => {
    const state = createReactive({ a: 1, b: 2 });
    effect(() => void state.a); // makes `a`'s signal
    let runs = 0;
    const read = computed(() =>
      readWholeObject(unwrap(state), () => (runs++, state.a), undefined, undefined),
    );
    read();
    state.b = 3;
    read();
    expect(runs).toBe(1);
    state.a = 2;
    expect(read()).toBe(2);
  });
});

describe("a list without a map reads each row's item as a whole", () => {
  it("reruns a row's filter on an unrelated write to it, but its readers don't rerun", () => {
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

  it("reruns no row on a write to a shared object a filter reads another field of", () => {
    const store = createReactive({
      minPriority: 1,
      selected: 0,
      tasks: [
        { id: 1, priority: 0 },
        { id: 2, priority: 2 },
      ],
    });
    let runs = 0;
    const list = computedList(() => store.tasks).filter(
      (task) => (runs++, task.priority >= store.minPriority),
    );
    effect(() => void list());
    runs = 0;
    store.selected = 1;
    list();
    expect(runs).toBe(0);
    store.minPriority = 0;
    expect(list().map((task) => task.id)).toEqual([1, 2]);
    expect(runs).toBe(2);
  });
});
