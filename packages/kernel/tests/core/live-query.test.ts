import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  batch,
  createReactive,
  effect,
  liveQuery,
  signal,
  stableComputed,
  unwrap,
} from "../../src";

interface Task {
  id: number;
  completed: boolean;
  priority: number;
  title: string;
}

function makeTasks(count: number): Task[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    completed: i % 2 === 0,
    priority: i % 7,
    title: `t${i}`,
  }));
}

const ids = (rows: ReadonlyArray<{ id: number }>) => rows.map((row) => row.id);

describe("liveQuery", () => {
  it("filters, sorts and windows the source", () => {
    const store = createReactive({ tasks: makeTasks(20) });
    const query = liveQuery({
      from: () => store.tasks,
      where: (task) => !task.completed,
      orderBy: (task) => [task.priority, task.id],
      offset: 1,
      limit: 3,
    });

    // Odd ids with priority 0, 1, 1, 2, ...: 7 (0), 1 (1), 15 (1), 9 (2).
    expect(ids(query())).toEqual([1, 15, 9]);
  });

  it("returns the same array, and only changed slots notify", () => {
    const store = createReactive({ tasks: makeTasks(10) });
    const query = liveQuery({ from: () => store.tasks, where: (task) => !task.completed });
    const result = query();
    const firstSlot = vi.fn();
    effect(() => void firstSlot(query()[0]!.id));
    firstSlot.mockClear();

    store.tasks[9]!.completed = true;
    expect(query()).toBe(result);
    expect(ids(result)).toEqual([1, 3, 5, 7]);
    expect(firstSlot).not.toHaveBeenCalled();
  });

  it("keeps fields of listed rows fine-grained", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const query = liveQuery({ from: () => store.tasks, where: (task) => !task.completed });
    const titles = vi.fn();
    const list = vi.fn();
    effect(() => void list(query().length));
    effect(() => void titles(query().map((task) => task.title)));
    titles.mockClear();
    list.mockClear();

    store.tasks[1]!.title = "renamed";
    expect(titles).toHaveBeenLastCalledWith(["renamed", "t3"]);
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps source order without orderBy, including reorders", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    const query = liveQuery({ from: () => store.tasks, where: (task) => !task.completed });
    expect(ids(query())).toEqual([1, 3, 5]);

    store.tasks.reverse();
    expect(ids(query())).toEqual([5, 3, 1]);
  });

  it("orders equal keys by first appearance in the source", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    const query = liveQuery({ from: () => store.tasks, orderBy: () => 0 });
    expect(ids(query())).toEqual([0, 1, 2, 3, 4, 5]);

    store.tasks.reverse();
    expect(ids(query())).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("follows pushes, splices, replaced elements and leave-then-return", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const query = liveQuery({ from: () => store.tasks, orderBy: (task) => task.id });

    store.tasks.push({ id: 10, completed: false, priority: 0, title: "new" });
    expect(ids(query())).toEqual([0, 1, 2, 3, 10]);

    const [removed] = store.tasks.splice(1, 1);
    expect(ids(query())).toEqual([0, 2, 3, 10]);

    store.tasks[0] = { id: 7, completed: false, priority: 0, title: "replaced" };
    expect(ids(query())).toEqual([2, 3, 7, 10]);

    store.tasks.push(removed!);
    expect(ids(query())).toEqual([1, 2, 3, 7, 10]);
  });

  it("reads a Map's values", () => {
    const tasks = createReactive(new Map(makeTasks(4).map((task) => [task.id, task])));
    const query = liveQuery({
      from: () => tasks.values(),
      where: (task) => !task.completed,
      orderBy: (task) => -task.id,
    });
    expect(ids(query())).toEqual([3, 1]);

    tasks.get(2)!.completed = false;
    tasks.delete(3);
    expect(ids(query())).toEqual([2, 1]);
  });

  it("is correct when read inside a batch", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const query = liveQuery({ from: () => store.tasks, where: (task) => !task.completed });
    batch(() => {
      store.tasks[1]!.completed = true;
      expect(ids(query())).toEqual([3]);
    });
  });

  it("runs a reader once per change, with fresh data, when the reader subscribed to the field first", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const query = liveQuery({ from: () => store.tasks, where: (task) => !task.completed });
    const seen: Array<[boolean, number[]]> = [];
    // The reader reads the field before the query, so it is notified first.
    effect(() => void seen.push([store.tasks[1]!.completed, ids(query())]));
    seen.length = 0;

    store.tasks[1]!.completed = true;
    expect(seen).toEqual([[true, [3]]]);
  });

  it("runs a reader once when many rows arrive at once", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const query = liveQuery({ from: () => store.tasks, orderBy: (task) => task.id });
    const lengths: number[] = [];
    effect(() => void lengths.push(query().length));
    lengths.length = 0;

    store.tasks = makeTasks(50);
    expect(lengths).toEqual([50]);
  });

  it("moves many rows at once when where reads shared state", () => {
    const store = createReactive({ tasks: makeTasks(100), showDone: false });
    const query = liveQuery({
      from: () => store.tasks,
      where: (task) => task.completed === store.showDone,
      orderBy: (task) => [task.priority, task.id],
      limit: 3,
    });
    expect(ids(query())).toEqual([7, 21, 35]);

    store.showDone = true;
    expect(ids(query())).toEqual([0, 14, 28]);
  });

  it("reads a reactive offset and limit", () => {
    const store = createReactive({ tasks: makeTasks(10) });
    const page = signal(0);
    const query = liveQuery({
      from: () => store.tasks,
      orderBy: (task) => task.id,
      offset: () => page() * 3,
      limit: 3,
    });
    expect(ids(query())).toEqual([0, 1, 2]);
    page(2);
    expect(ids(query())).toEqual([6, 7, 8]);
  });

  it("counts the same object once and rejects rows that aren't objects", () => {
    const task = { id: 1, completed: false, priority: 0, title: "a" };
    const store = createReactive({ tasks: [task, task] });
    expect(ids(liveQuery({ from: () => store.tasks })())).toEqual([1]);

    const bad = liveQuery({ from: () => [1] as unknown as Task[] });
    expect(() => bad()).toThrow(/must be objects/);
  });

  it("sorts null, undefined and NaN keys last without corrupting the order", () => {
    const store = createReactive({
      tasks: [3, Number.NaN, 1, undefined, 2].map((priority, id) => ({ id, priority })),
    });
    const query = liveQuery({ from: () => store.tasks, orderBy: (task) => task.priority });
    expect(ids(query())).toEqual([2, 4, 0, 1, 3]);

    store.tasks[1]!.priority = 0;
    store.tasks[2]!.priority = Number.NaN;
    expect(ids(query())).toEqual([1, 4, 0, 2, 3]);
  });

  it("orders mixed key types by type name, and arrays element by element", () => {
    const keys: unknown[] = ["b", 2, [1, 2], "a", 1n, [1], 1];
    const store = createReactive({ rows: keys.map((key, id) => ({ id, key })) });
    const query = liveQuery({ from: () => store.rows, orderBy: (row) => row.key });
    // bigint < number < object (arrays) < string.
    expect(query().map((row) => row.key)).toEqual([1n, 1, 2, [1], [1, 2], "a", "b"]);
  });

  it("doesn't wake readers when a row's result is unchanged", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const query = liveQuery({
      from: () => store.tasks,
      where: (task) => task.title.length > 0,
      orderBy: (task) => task.id,
    });
    const reader = vi.fn();
    effect(() => void reader(ids(query())));
    reader.mockClear();

    store.tasks[1]!.title = "still has a title";
    expect(ids(query())).toEqual([0, 1, 2, 3]);
    expect(reader).not.toHaveBeenCalled();
  });

  it("still finds a row when compare is inconsistent", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    let direction = 1;
    const query = liveQuery({
      from: () => store.tasks,
      orderBy: (task) => task.id,
      compare: (a, b) => direction * (a - b),
    });
    expect(ids(query())).toEqual([0, 1, 2, 3, 4, 5]);

    direction = -1;
    store.tasks.splice(1, 1);
    expect(ids(query())).not.toContain(1);
    expect(query()).toHaveLength(5);
  });

  it("surfaces a throwing where on read, leaves other effects alone, and recovers", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const query = liveQuery({
      from: () => store.tasks,
      where: (task) => {
        if (task.title === "boom") throw new Error("boom");
        return !task.completed;
      },
    });
    expect(ids(query())).toEqual([1, 3]);
    const other = vi.fn();
    effect(() => void other(store.tasks[1]!.title));
    other.mockClear();

    store.tasks[1]!.title = "boom";
    expect(other).toHaveBeenCalledTimes(1);
    expect(() => query()).toThrow("boom");

    store.tasks[1]!.title = "fine";
    store.tasks[1]!.completed = true;
    expect(ids(query())).toEqual([3]);
  });

  it("does not subscribe the query to reactive reads inside compare", () => {
    const store = createReactive({ tasks: makeTasks(4), flag: false });
    let reads = 0;
    const query = liveQuery({
      from: () => {
        reads++;
        return store.tasks;
      },
      orderBy: (task) => task.id,
      compare: (a, b) => (store.flag ? 0 : 0) + a - b,
    });
    store.tasks[0]!.id = 9;
    expect(ids(query())).toEqual([1, 2, 3, 9]);
    reads = 0;

    store.flag = true;
    query();
    expect(reads).toBe(0);
  });
});

// The four changes from the TanStack DB comparison: 1,000 tasks, "not
// completed, by priority, top 10". `stableComputed` skips fields the query
// never read but redoes the whole filter and sort otherwise; `liveQuery` also
// skips those, and otherwise touches only the changed row.
describe("work per change", () => {
  type Key = readonly [number, number];
  type Build = (
    store: { tasks: Task[] },
    where: (task: Task) => boolean,
    compare: (a: Key, b: Key) => number,
  ) => () => ReadonlyArray<Task>;

  function measure(build: Build) {
    const store = createReactive({ tasks: makeTasks(1000) });
    const counts = { where: 0, compare: 0, reader: 0 };
    const query = build(
      store,
      (task) => {
        counts.where++;
        return !task.completed;
      },
      (a, b) => {
        counts.compare++;
        return a[0] - b[0] || a[1] - b[1];
      },
    );
    effect(() => {
      query().forEach((task) => task.id);
      counts.reader++;
    });
    const step = (change: () => void) => {
      counts.where = counts.compare = counts.reader = 0;
      change();
      query();
      return { ...counts };
    };
    return {
      top: ids(query()),
      a: step(() => (store.tasks[5]!.title = "renamed")),
      b: step(() => (store.tasks[2]!.priority = 3)),
      c: step(() => (store.tasks[401]!.completed = true)),
      d: step(() => (store.tasks[7]!.completed = true)),
      after: ids(query()),
    };
  }

  const keyOf = (task: Task): Key => [task.priority, task.id];

  it("stableComputed: nothing for unread fields, everything otherwise", () => {
    const counts = measure((store, where, compare) =>
      stableComputed(() =>
        store.tasks
          .filter(where)
          .sort((a, b) => compare(keyOf(a), keyOf(b)))
          .slice(0, 10),
      ),
    );
    expect(counts.a).toEqual({ where: 0, compare: 0, reader: 0 });
    expect(counts.b).toEqual({ where: 0, compare: 0, reader: 0 });
    expect(counts.c.where).toBe(1000);
    expect(counts.c.compare).toBeGreaterThan(2000);
    expect(counts.c.reader).toBe(0);
    expect(counts.d.where).toBe(1000);
    expect(counts.d.reader).toBe(1);
  });

  it("liveQuery: nothing for unread fields, one row otherwise", () => {
    const counts = measure((store, where, compare) =>
      liveQuery({ from: () => store.tasks, where, orderBy: keyOf, compare, limit: 10 }),
    );
    expect(counts.top).toEqual([7, 21, 35, 49, 63, 77, 91, 105, 119, 133]);
    expect(counts.a).toEqual({ where: 0, compare: 0, reader: 0 });
    expect(counts.b).toEqual({ where: 0, compare: 0, reader: 0 });
    // Removing one row from 500 sorted rows: one binary search.
    expect(counts.c.where).toBe(1);
    expect(counts.c.compare).toBeLessThanOrEqual(10);
    expect(counts.c.reader).toBe(0);
    expect(counts.d.where).toBe(1);
    expect(counts.d.compare).toBeLessThanOrEqual(10);
    expect(counts.d.reader).toBe(1);
    expect(counts.after).toEqual([21, 35, 49, 63, 77, 91, 105, 119, 133, 147]);
  });
});

describe("liveQuery matches a from-scratch reference", () => {
  type Op =
    | { type: "toggle"; index: number }
    | { type: "priority"; index: number; value: number }
    | { type: "push"; priority: number; completed: boolean }
    | { type: "remove"; index: number }
    | { type: "replace"; index: number; priority: number }
    | { type: "swap"; a: number; b: number }
    | { type: "window"; offset: number; limit: number };

  const index = fc.nat({ max: 30 });
  const priority = fc.integer({ min: 0, max: 4 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ type: fc.constant("toggle" as const), index }),
    fc.record({ type: fc.constant("priority" as const), index, value: priority }),
    fc.record({ type: fc.constant("push" as const), priority, completed: fc.boolean() }),
    fc.record({ type: fc.constant("remove" as const), index }),
    fc.record({ type: fc.constant("replace" as const), index, priority }),
    fc.record({ type: fc.constant("swap" as const), a: index, b: index }),
    fc.record({
      type: fc.constant("window" as const),
      offset: fc.nat({ max: 5 }),
      limit: fc.integer({ min: 0, max: 8 }),
    }),
  );

  it("after every step, with and without orderBy, batched or not", () => {
    fc.assert(
      fc.property(
        fc.array(op, { maxLength: 40 }),
        fc.boolean(),
        fc.boolean(),
        (ops, sortRows, batched) => {
          let nextId = 0;
          const task = (p: number, completed = false): Task => ({
            id: nextId++,
            completed,
            priority: p,
            title: "",
          });
          const store = createReactive({
            tasks: [task(1), task(0, true), task(2), task(1)],
            offset: 0,
            limit: 5,
          });
          const where = (t: Task) => !t.completed;
          // Keys are unique, so tie order doesn't matter to the reference.
          const query = liveQuery({
            from: () => store.tasks,
            where,
            ...(sortRows && { orderBy: (t: Task) => [t.priority, t.id] }),
            offset: () => store.offset,
            limit: () => store.limit,
          });
          const expected = () => {
            const rows = unwrap(store.tasks).filter(where);
            if (sortRows) rows.sort((a, b) => a.priority - b.priority || a.id - b.id);
            return ids(rows.slice(store.offset, store.offset + store.limit));
          };
          const at = (i: number) => (store.tasks.length ? i % store.tasks.length : -1);

          for (const step of ops) {
            const apply = () => {
              const i = at("index" in step ? step.index : 0);
              if (step.type === "push") store.tasks.push(task(step.priority, step.completed));
              else if (step.type === "window") {
                store.offset = step.offset;
                store.limit = step.limit;
              } else if (i < 0) return;
              else if (step.type === "toggle")
                store.tasks[i]!.completed = !store.tasks[i]!.completed;
              else if (step.type === "priority") store.tasks[i]!.priority = step.value;
              else if (step.type === "remove") store.tasks.splice(i, 1);
              else if (step.type === "replace") store.tasks[i] = task(step.priority);
              else if (step.type === "swap") {
                const a = at(step.a);
                const b = at(step.b);
                const first = store.tasks[a]!;
                store.tasks[a] = store.tasks[b]!;
                store.tasks[b] = first;
              }
            };
            if (batched) batch(apply);
            else apply();
            expect(ids(query())).toEqual(expected());
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
