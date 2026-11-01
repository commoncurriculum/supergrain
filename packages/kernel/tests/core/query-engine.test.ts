import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { batch, createReactive, effect, signal, stableComputed, unwrap } from "../../src";
import { defaultCompare } from "../../src/query/compare";
import { toGetter } from "../../src/query/computed-list";
import { createList } from "../../src/query/list";

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

/**
 * `createList` with one filter, one sort key and a custom `compare`. These
 * tests reach engine paths that `computedList`'s chain can't easily reach (a
 * throwing or inconsistent `compare`). `query.test.ts` covers the public API.
 */
function engine<T extends object, K = unknown>(options: {
  source: () => Iterable<T>;
  filter?: (row: T) => boolean;
  sortKey?: (row: T) => K;
  compare?: (a: K, b: K) => number;
  offset?: number | (() => number);
  limit?: number | (() => number);
}): () => ReadonlyArray<T> {
  const { source, filter, sortKey } = options;
  return createList<T, T, K | undefined>({
    source,
    run: (item) =>
      filter && !filter(item)
        ? { member: false }
        : { member: true, value: item, key: sortKey?.(item) },
    compare: sortKey
      ? ((options.compare ?? defaultCompare) as (a: K | undefined, b: K | undefined) => number)
      : undefined,
    offset: toGetter(options.offset, 0),
    limit: toGetter(options.limit, Infinity),
  });
}

const ids = (rows: ReadonlyArray<{ id: number }>) => rows.map((row) => row.id);

describe("query engine", () => {
  it("filters, sorts and windows the source", () => {
    const store = createReactive({ tasks: makeTasks(20) });
    const view = engine({
      source: () => store.tasks,
      filter: (task) => !task.completed,
      sortKey: (task) => [task.priority, task.id],
      offset: 1,
      limit: 3,
    });

    // Odd ids with priority 0, 1, 1, 2, ...: 7 (0), 1 (1), 15 (1), 9 (2).
    expect(ids(view())).toEqual([1, 15, 9]);
  });

  it("returns the same array, and only changed slots notify", () => {
    const store = createReactive({ tasks: makeTasks(10) });
    const view = engine({ source: () => store.tasks, filter: (task) => !task.completed });
    const result = view();
    const firstSlot = vi.fn();
    effect(() => void firstSlot(view()[0]!.id));
    firstSlot.mockClear();

    store.tasks[9]!.completed = true;
    expect(view()).toBe(result);
    expect(ids(result)).toEqual([1, 3, 5, 7]);
    expect(firstSlot).not.toHaveBeenCalled();
  });

  it("keeps fields of listed rows fine-grained", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({ source: () => store.tasks, filter: (task) => !task.completed });
    const titles = vi.fn();
    const lengths = vi.fn();
    effect(() => void lengths(view().length));
    effect(() => void titles(view().map((task) => task.title)));
    titles.mockClear();
    lengths.mockClear();

    store.tasks[1]!.title = "renamed";
    expect(titles).toHaveBeenLastCalledWith(["renamed", "t3"]);
    expect(lengths).not.toHaveBeenCalled();
  });

  it("keeps source order without a sort, including reorders", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    const view = engine({ source: () => store.tasks, filter: (task) => !task.completed });
    expect(ids(view())).toEqual([1, 3, 5]);

    store.tasks.reverse();
    expect(ids(view())).toEqual([5, 3, 1]);
  });

  it("orders equal keys by first appearance in the source", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    const view = engine({ source: () => store.tasks, sortKey: () => 0 });
    expect(ids(view())).toEqual([0, 1, 2, 3, 4, 5]);

    store.tasks.reverse();
    expect(ids(view())).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("follows pushes, splices, replaced elements and leave-then-return", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({ source: () => store.tasks, sortKey: (task) => task.id });

    store.tasks.push({ id: 10, completed: false, priority: 0, title: "new" });
    expect(ids(view())).toEqual([0, 1, 2, 3, 10]);

    const [removed] = store.tasks.splice(1, 1);
    expect(ids(view())).toEqual([0, 2, 3, 10]);

    store.tasks[0] = { id: 7, completed: false, priority: 0, title: "replaced" };
    expect(ids(view())).toEqual([2, 3, 7, 10]);

    store.tasks.push(removed!);
    expect(ids(view())).toEqual([1, 2, 3, 7, 10]);
  });

  it("without a sort, follows a filter change and a reactive limit", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    const limit = signal(10);
    const view = engine({ source: () => store.tasks, filter: (task) => !task.completed, limit });
    expect(ids(view())).toEqual([1, 3, 5]);

    store.tasks[0]!.completed = false;
    expect(ids(view())).toEqual([0, 1, 3, 5]);

    limit(2);
    expect(ids(view())).toEqual([0, 1]);
  });

  it("drops a row that arrived and left while the source walk was throwing", () => {
    const store = createReactive({ tasks: makeTasks(4) as unknown[] });
    const view = engine({ source: () => store.tasks as Task[], sortKey: (task) => task.id });
    expect(ids(view())).toEqual([0, 1, 2, 3]);

    // The walk meets the new task, then throws on the number after it.
    store.tasks.push({ id: 9, completed: false, priority: 0, title: "new" }, 5);
    expect(() => view()).toThrow();

    store.tasks.splice(4);
    expect(ids(view())).toEqual([0, 1, 2, 3]);
  });

  it("regroups its blocks after most rows leave, and stays correct", () => {
    // 64 rows fill 4 blocks of 16. Keeping 10 leaves more sparse blocks
    // than the list needs, so the next walk regroups every row.
    const store = createReactive({ tasks: makeTasks(64) });
    const view = engine({ source: () => store.tasks, sortKey: (task) => -task.id });
    expect(view()).toHaveLength(64);

    store.tasks.splice(10);
    expect(ids(view())).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

    store.tasks[3]!.id = 100;
    store.tasks.push({ id: 50, completed: false, priority: 0, title: "new" });
    expect(ids(view())).toEqual([100, 50, 9, 8, 7, 6, 5, 4, 2, 1, 0]);
  });

  it("reads a Map's values", () => {
    const tasks = createReactive(new Map(makeTasks(4).map((task) => [task.id, task])));
    const view = engine({
      source: () => tasks.values(),
      filter: (task) => !task.completed,
      sortKey: (task) => -task.id,
    });
    expect(ids(view())).toEqual([3, 1]);

    tasks.get(2)!.completed = false;
    tasks.delete(3);
    expect(ids(view())).toEqual([2, 1]);
  });

  it("is correct when read inside a batch", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({ source: () => store.tasks, filter: (task) => !task.completed });
    batch(() => {
      store.tasks[1]!.completed = true;
      expect(ids(view())).toEqual([3]);
    });
  });

  it("runs a reader once per change, with fresh data, when the reader subscribed to the field first", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({ source: () => store.tasks, filter: (task) => !task.completed });
    const seen: Array<[boolean, number[]]> = [];
    // The reader reads the field before the list, so it is notified first.
    effect(() => void seen.push([store.tasks[1]!.completed, ids(view())]));
    seen.length = 0;

    store.tasks[1]!.completed = true;
    expect(seen).toEqual([[true, [3]]]);
  });

  it("runs a reader once when many rows arrive at once", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({ source: () => store.tasks, sortKey: (task) => task.id });
    const lengths: number[] = [];
    effect(() => void lengths.push(view().length));
    lengths.length = 0;

    store.tasks = makeTasks(50);
    expect(lengths).toEqual([50]);
  });

  it("moves many rows at once when the filter reads shared state", () => {
    const store = createReactive({ tasks: makeTasks(100), showDone: false });
    const view = engine({
      source: () => store.tasks,
      filter: (task) => task.completed === store.showDone,
      sortKey: (task) => [task.priority, task.id],
      limit: 3,
    });
    expect(ids(view())).toEqual([7, 21, 35]);

    store.showDone = true;
    expect(ids(view())).toEqual([0, 14, 28]);
  });

  it("reads a reactive offset and limit", () => {
    const store = createReactive({ tasks: makeTasks(10) });
    const page = signal(0);
    const view = engine({
      source: () => store.tasks,
      sortKey: (task) => task.id,
      offset: () => page() * 3,
      limit: 3,
    });
    expect(ids(view())).toEqual([0, 1, 2]);
    page(2);
    expect(ids(view())).toEqual([6, 7, 8]);
  });

  it("counts the same object once and rejects rows that aren't objects", () => {
    const task = { id: 1, completed: false, priority: 0, title: "a" };
    const store = createReactive({ tasks: [task, task] });
    expect(ids(engine({ source: () => store.tasks })())).toEqual([1]);

    const bad = engine({ source: () => [1] as unknown as Task[] });
    expect(() => bad()).toThrow(/must be objects/);
  });

  describe("follows a store array through its changes", () => {
    const all = (store: { tasks: Task[] }) =>
      ids(unwrap(store.tasks).filter((task, i, list) => list.indexOf(task) === i));

    it("between reads, however many there were", () => {
      const store = createReactive({ tasks: makeTasks(5) });
      const view = engine({ source: () => store.tasks });
      view();
      for (let i = 0; i < 300; i++) store.tasks.push(makeTasks(1)[0]!);
      store.tasks.splice(2, 290);
      expect(ids(view())).toEqual(all(store));
    });

    it("with the same object twice: counted once, at its first position", () => {
      const store = createReactive({ tasks: makeTasks(3) });
      const view = engine({ source: () => store.tasks });
      view();
      store.tasks.push(store.tasks[0]!);
      expect(ids(view())).toEqual([0, 1, 2]);
      store.tasks.shift();
      expect(ids(view())).toEqual([1, 2, 0]);
      store.tasks.pop();
      expect(ids(view())).toEqual([1, 2]);
    });

    it("with holes", () => {
      const store = createReactive({ tasks: makeTasks(4) });
      const view = engine({ source: () => store.tasks });
      view();
      delete store.tasks[1];
      expect(ids(view())).toEqual([0, 2, 3]);
      store.tasks.push({ id: 9, completed: false, priority: 0, title: "" });
      expect(ids(view())).toEqual([0, 2, 3, 9]);
      store.tasks[1] = { id: 8, completed: false, priority: 0, title: "" };
      expect(ids(view())).toEqual([0, 8, 2, 3, 9]);
      store.tasks.splice(0, 1);
      expect(ids(view())).toEqual([8, 2, 3, 9]);
    });

    it("when the source becomes another array, or not a store array", () => {
      const store = createReactive({ tasks: makeTasks(3), plain: true });
      const other = makeTasks(5).slice(3);
      const view = engine({ source: () => (store.plain ? store.tasks : other) });
      view();
      store.tasks = makeTasks(2);
      expect(ids(view())).toEqual([0, 1]);
      store.plain = false;
      expect(ids(view())).toEqual([3, 4]);
      store.plain = true;
      store.tasks.push({ id: 7, completed: false, priority: 0, title: "" });
      expect(ids(view())).toEqual([0, 1, 7]);
    });

    it("past an item that isn't an object and left before the read", () => {
      const store = createReactive({ tasks: makeTasks(2) as unknown[] });
      const view = engine({ source: () => store.tasks as Task[] });
      view();
      batch(() => {
        store.tasks.push(5);
        store.tasks.pop();
      });
      expect(ids(view())).toEqual([0, 1]);
    });

    it("without running the steps of rows that didn't change", () => {
      const store = createReactive({ tasks: makeTasks(100) });
      let runs = 0;
      const view = engine({
        source: () => store.tasks,
        filter: (task) => (runs++, !task.completed),
        sortKey: (task) => task.priority,
      });
      view();
      runs = 0;
      store.tasks.splice(50, 1);
      store.tasks.push({ id: 100, completed: false, priority: 0, title: "" });
      view();
      expect(runs).toBe(1);
    });
  });

  it("sorts null, undefined and NaN keys last without corrupting the order", () => {
    const store = createReactive({
      tasks: [3, Number.NaN, 1, undefined, 2].map((priority, id) => ({ id, priority })),
    });
    const view = engine({ source: () => store.tasks, sortKey: (task) => task.priority });
    expect(ids(view())).toEqual([2, 4, 0, 1, 3]);

    store.tasks[1]!.priority = 0;
    store.tasks[2]!.priority = Number.NaN;
    expect(ids(view())).toEqual([1, 4, 0, 2, 3]);
  });

  it("orders mixed key types by type name, and arrays element by element", () => {
    const keys: unknown[] = ["b", 2, [1, 2], "a", 1n, [1], 1];
    const store = createReactive({ rows: keys.map((key, id) => ({ id, key })) });
    const view = engine({ source: () => store.rows, sortKey: (row) => row.key });
    // bigint < number < object (arrays) < string.
    expect(view().map((row) => row.key)).toEqual([1n, 1, 2, [1], [1, 2], "a", "b"]);
  });

  it("doesn't wake readers when a row's result is unchanged", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({
      source: () => store.tasks,
      filter: (task) => task.title.length > 0,
      sortKey: (task) => task.id,
    });
    const reader = vi.fn();
    effect(() => void reader(ids(view())));
    reader.mockClear();

    store.tasks[1]!.title = "still has a title";
    expect(ids(view())).toEqual([0, 1, 2, 3]);
    expect(reader).not.toHaveBeenCalled();
  });

  it("still finds a row when compare is inconsistent", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    let direction = 1;
    const view = engine({
      source: () => store.tasks,
      sortKey: (task) => task.id,
      compare: (a, b) => direction * (a - b),
    });
    expect(ids(view())).toEqual([0, 1, 2, 3, 4, 5]);

    direction = -1;
    store.tasks.splice(1, 1);
    expect(ids(view())).not.toContain(1);
    expect(view()).toHaveLength(5);
  });

  it("surfaces a throwing filter on read, leaves other effects alone, and recovers", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({
      source: () => store.tasks,
      filter: (task) => {
        if (task.title === "boom") throw new Error("boom");
        return !task.completed;
      },
    });
    expect(ids(view())).toEqual([1, 3]);
    const other = vi.fn();
    effect(() => void other(store.tasks[1]!.title));
    other.mockClear();

    store.tasks[1]!.title = "boom";
    expect(other).toHaveBeenCalledTimes(1);
    expect(() => view()).toThrow("boom");

    store.tasks[1]!.title = "fine";
    store.tasks[1]!.completed = true;
    expect(ids(view())).toEqual([3]);
  });

  it("keeps every row after a filter that throws part-way through the source", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    const view = engine({
      source: () => store.tasks,
      filter: (task) => {
        if (task.title === "boom") throw new Error("boom");
        return !task.completed;
      },
      sortKey: (task) => task.id,
    });
    expect(ids(view())).toEqual([1, 3, 5]);

    store.tasks[4]!.title = "boom";
    expect(() => view()).toThrow("boom");
    store.tasks[4]!.title = "fine";
    expect(ids(view())).toEqual([1, 3, 5]);
  });

  it("keeps throwing on every read until a field the failing row read changes", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    let fail = false;
    const view = engine({
      source: () => store.tasks,
      filter: (task) => {
        const visible = !task.completed && task.title !== "hidden";
        if (fail && task.id === 1) throw new Error("filter");
        return visible;
      },
    });
    expect(ids(view())).toEqual([1, 3]);

    fail = true;
    store.tasks[1]!.title = "x";
    expect(() => view()).toThrow("filter");
    fail = false;
    // Not stale data: the failure is cached until row 1 changes again.
    expect(() => view()).toThrow("filter");
    store.tasks[1]!.title = "y";
    expect(ids(view())).toEqual([1, 3]);
  });

  it("rebuilds the order after a compare that throws part-way through an update", () => {
    const store = createReactive({ tasks: makeTasks(6) });
    let fail = false;
    const view = engine({
      source: () => store.tasks,
      filter: (task) => !task.completed,
      sortKey: (task) => task.priority,
      compare: (a, b) => {
        if (fail) throw new Error("compare");
        return a - b;
      },
    });
    expect(ids(view())).toEqual([1, 3, 5]);

    // Row 0 enters the result, so it is inserted with a binary search that throws.
    fail = true;
    store.tasks[0]!.completed = false;
    expect(() => view()).toThrow("compare");
    fail = false;
    store.tasks[4]!.completed = false;
    expect(ids(view())).toEqual([0, 1, 3, 4, 5]);
  });

  it("keeps every change of an update that compare threw part-way through", () => {
    const store = createReactive({ tasks: makeTasks(100) });
    let failOn: number | undefined = undefined;
    const view = engine({
      source: () => store.tasks,
      filter: (task) => !task.completed,
      sortKey: (task) => task.id,
      compare: (a: number, b: number) => {
        if (a === failOn || b === failOn) throw new Error("compare");
        return a - b;
      },
    });
    view();
    // Row 3 is refiled first; finding row 91, in a later block, throws.
    failOn = 91;
    batch(() => {
      store.tasks[3]!.completed = true;
      store.tasks[91]!.completed = true;
    });
    expect(() => view()).toThrow("compare");
    // The list keeps rethrowing until something it read changes.
    failOn = undefined;
    store.tasks[51]!.completed = true;
    expect(ids(view())).toEqual(ids(unwrap(store.tasks).filter((task) => !task.completed)));
  });

  it("drops rows that left the source while a filter was throwing", () => {
    const store = createReactive({ tasks: makeTasks(4) });
    const view = engine({
      source: () => store.tasks,
      filter: (task) => {
        if (task.title === "boom") throw new Error("boom");
        return true;
      },
      sortKey: (task) => task.id,
    });
    expect(ids(view())).toEqual([0, 1, 2, 3]);

    store.tasks[3]!.title = "boom";
    const removed = store.tasks.shift()!;
    expect(() => view()).toThrow("boom");

    store.tasks[2]!.title = "fine";
    store.tasks.push({ id: 9, completed: false, priority: 0, title: "t9" });
    expect(ids(view())).toEqual([1, 2, 3, 9]);

    // Added back, it shows once.
    store.tasks.push(removed);
    expect(ids(view())).toEqual([0, 1, 2, 3, 9]);
  });

  it("does not subscribe rows to reactive reads inside compare", () => {
    const store = createReactive({ tasks: makeTasks(4), flag: false });
    let sortKeyCalls = 0;
    const view = engine({
      source: () => store.tasks,
      sortKey: (task) => (sortKeyCalls++, task.priority),
      compare: (a, b) => (store.flag ? 0 : 0) + a - b,
    });
    view();
    // Row 0 recomputes and compares its new key with the old one.
    store.tasks[0]!.priority = 5;
    view();
    sortKeyCalls = 0;

    store.flag = true;
    view();
    expect(sortKeyCalls).toBe(0);
  });

  it("treats a negative offset or limit as zero", () => {
    const store = createReactive({ tasks: makeTasks(5), offset: -2, limit: 2 });
    const view = engine({
      source: () => store.tasks,
      sortKey: (task) => task.id,
      offset: () => store.offset,
      limit: () => store.limit,
    });
    expect(ids(view())).toEqual([0, 1]);
    store.limit = -1;
    expect(ids(view())).toEqual([]);
  });

  it("does not subscribe the list to reactive reads inside compare", () => {
    const store = createReactive({ tasks: makeTasks(4), flag: false });
    let reads = 0;
    const view = engine({
      source: () => {
        reads++;
        return store.tasks;
      },
      sortKey: (task) => task.id,
      compare: (a, b) => (store.flag ? 0 : 0) + a - b,
    });
    store.tasks[0]!.id = 9;
    expect(ids(view())).toEqual([1, 2, 3, 9]);
    reads = 0;

    store.flag = true;
    view();
    expect(reads).toBe(0);
  });
});

// The four changes from the TanStack DB comparison: 1,000 tasks, "not
// completed, by priority, top 10". `stableComputed` skips fields the list
// never read but redoes the whole filter and sort otherwise; the query engine also
// skips those, and otherwise touches only the changed row.
describe("work per change", () => {
  type Key = readonly [number, number];
  type Build = (
    store: { tasks: Task[] },
    filter: (task: Task) => boolean,
    compare: (a: Key, b: Key) => number,
  ) => () => ReadonlyArray<Task>;

  function measure(build: Build) {
    const store = createReactive({ tasks: makeTasks(1000) });
    const counts = { filter: 0, compare: 0, reader: 0 };
    const view = build(
      store,
      (task) => {
        counts.filter++;
        return !task.completed;
      },
      (a, b) => {
        counts.compare++;
        return a[0] - b[0] || a[1] - b[1];
      },
    );
    effect(() => {
      view().forEach((task) => task.id);
      counts.reader++;
    });
    const step = (change: () => void) => {
      counts.filter = counts.compare = counts.reader = 0;
      change();
      view();
      return { ...counts };
    };
    return {
      top: ids(view()),
      a: step(() => (store.tasks[5]!.title = "renamed")),
      b: step(() => (store.tasks[2]!.priority = 3)),
      c: step(() => (store.tasks[401]!.completed = true)),
      d: step(() => (store.tasks[7]!.completed = true)),
      after: ids(view()),
      push: step(() => store.tasks.push({ id: 1000, completed: false, priority: 0, title: "" })),
      remove: step(() => store.tasks.splice(300, 1)),
    };
  }

  const keyOf = (task: Task): Key => [task.priority, task.id];

  it("stableComputed: nothing for unread fields, everything otherwise", () => {
    const counts = measure((store, filter, compare) =>
      stableComputed(() =>
        store.tasks
          .filter(filter)
          .sort((a, b) => compare(keyOf(a), keyOf(b)))
          .slice(0, 10),
      ),
    );
    expect(counts.a).toEqual({ filter: 0, compare: 0, reader: 0 });
    expect(counts.b).toEqual({ filter: 0, compare: 0, reader: 0 });
    expect(counts.c.filter).toBe(1000);
    expect(counts.c.compare).toBeGreaterThan(2000);
    expect(counts.c.reader).toBe(0);
    expect(counts.d.filter).toBe(1000);
    expect(counts.d.reader).toBe(1);
  });

  it("query engine: nothing for unread fields, one row otherwise", () => {
    const counts = measure((store, filter, compare) =>
      engine({ source: () => store.tasks, filter, sortKey: keyOf, compare, limit: 10 }),
    );
    expect(counts.top).toEqual([7, 21, 35, 49, 63, 77, 91, 105, 119, 133]);
    expect(counts.a).toEqual({ filter: 0, compare: 0, reader: 0 });
    expect(counts.b).toEqual({ filter: 0, compare: 0, reader: 0 });
    // Removing one row from 500 sorted rows: one binary search.
    expect(counts.c.filter).toBe(1);
    expect(counts.c.compare).toBeLessThanOrEqual(10);
    expect(counts.c.reader).toBe(0);
    expect(counts.d.filter).toBe(1);
    expect(counts.d.compare).toBeLessThanOrEqual(10);
    expect(counts.d.reader).toBe(1);
    expect(counts.after).toEqual([21, 35, 49, 63, 77, 91, 105, 119, 133, 147]);
    // Adding or removing a row runs the filter for that row only.
    expect(counts.push.filter).toBe(1);
    expect(counts.push.compare).toBeLessThanOrEqual(10);
    expect(counts.remove.filter).toBe(0);
    expect(counts.remove.compare).toBeLessThanOrEqual(10);
  });
});

describe("query engine matches a from-scratch reference", () => {
  type Op =
    | { type: "toggle"; index: number }
    | { type: "priority"; index: number; value: number }
    | { type: "push"; priority: number; completed: boolean }
    | { type: "pushMany"; count: number }
    | { type: "remove"; index: number; count: number }
    | { type: "reinsert"; index: number }
    | { type: "replace"; index: number; priority: number }
    | { type: "swap"; a: number; b: number }
    | { type: "window"; offset: number; limit: number }
    | { type: "poison"; index: number }
    | { type: "cure" }
    | { type: "pushBadRow" }
    | { type: "dropBadRows" };

  const index = fc.nat({ max: 1000 });
  const priority = fc.integer({ min: 0, max: 4 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ type: fc.constant("toggle" as const), index }),
    fc.record({ type: fc.constant("priority" as const), index, value: priority }),
    fc.record({ type: fc.constant("push" as const), priority, completed: fc.boolean() }),
    fc.record({ type: fc.constant("pushMany" as const), count: fc.integer({ min: 1, max: 40 }) }),
    fc.record({
      type: fc.constant("remove" as const),
      index,
      count: fc.integer({ min: 1, max: 30 }),
    }),
    fc.record({ type: fc.constant("reinsert" as const), index }),
    fc.record({ type: fc.constant("replace" as const), index, priority }),
    fc.record({ type: fc.constant("swap" as const), a: index, b: index }),
    fc.record({
      type: fc.constant("window" as const),
      offset: fc.nat({ max: 5 }),
      limit: fc.integer({ min: 0, max: 8 }),
    }),
    fc.record({ type: fc.constant("poison" as const), index }),
    fc.record({ type: fc.constant("cure" as const) }),
    fc.record({ type: fc.constant("pushBadRow" as const) }),
    fc.record({ type: fc.constant("dropBadRows" as const) }),
  );

  // A row titled "boom" makes the filter throw, and a row that isn't an object
  // makes the source walk throw. The list must throw exactly while one is
  // present, and be right again after.
  it("after every step, sorted or not, batched or not, through throws", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 80 }),
        fc.array(op, { maxLength: 40 }),
        fc.boolean(),
        fc.boolean(),
        (initial, ops, sortRows, batched) => {
          let nextId = 0;
          const task = (p: number, completed = false): Task => ({
            id: nextId++,
            completed,
            priority: p,
            title: "",
          });
          const store = createReactive({
            tasks: Array.from({ length: initial }, (_, i) => task(i % 3, i % 4 === 0)),
            offset: 0,
            limit: 5,
          });
          const removed: Task[] = [];
          const filter = (t: Task) => {
            if (t.title === "boom") throw new Error("boom");
            return !t.completed;
          };
          // Keys are unique, so tie order doesn't matter to the reference.
          const view = engine({
            source: () => store.tasks,
            filter,
            ...(sortRows && { sortKey: (t: Task) => [t.priority, t.id] }),
            offset: () => store.offset,
            limit: () => store.limit,
          });
          const isTask = (t: unknown): t is Task => typeof t === "object" && t !== null;
          const failing = () => unwrap(store.tasks).some((t) => !isTask(t) || t.title === "boom");
          const expected = () => {
            const rows = unwrap(store.tasks).filter(filter);
            if (sortRows) rows.sort((a, b) => a.priority - b.priority || a.id - b.id);
            return ids(rows.slice(store.offset, store.offset + store.limit));
          };
          const at = (i: number) => (store.tasks.length ? i % store.tasks.length : -1);
          const taskAt = (i: number): Task | undefined => {
            const t = store.tasks[at(i)];
            return isTask(t) ? t : undefined;
          };

          for (const step of ops) {
            const apply = () => {
              const tasks = store.tasks;
              switch (step.type) {
                case "push":
                  tasks.push(task(step.priority, step.completed));
                  break;
                case "pushMany":
                  tasks.push(
                    ...Array.from({ length: step.count }, (_, i) => task(i % 5, i % 3 === 0)),
                  );
                  break;
                case "window":
                  store.offset = step.offset;
                  store.limit = step.limit;
                  break;
                case "remove":
                  if (tasks.length)
                    removed.push(...tasks.splice(at(step.index), step.count).filter(isTask));
                  break;
                case "reinsert": {
                  const back = removed.pop();
                  if (back) tasks.splice(Math.max(0, at(step.index)), 0, back);
                  break;
                }
                case "replace":
                  if (tasks.length) tasks[at(step.index)] = task(step.priority);
                  break;
                case "swap":
                  if (tasks.length) {
                    const a = at(step.a);
                    const b = at(step.b);
                    const first = tasks[a]!;
                    tasks[a] = tasks[b]!;
                    tasks[b] = first;
                  }
                  break;
                case "cure":
                  for (const t of tasks) if (isTask(t) && t.title === "boom") t.title = "";
                  break;
                case "pushBadRow":
                  (tasks as unknown[]).push(0);
                  break;
                case "dropBadRows":
                  for (let i = tasks.length - 1; i >= 0; i--)
                    if (!isTask(tasks[i])) tasks.splice(i, 1);
                  break;
                default: {
                  const t = taskAt("index" in step ? step.index : 0);
                  if (!t) break;
                  if (step.type === "toggle") t.completed = !t.completed;
                  else if (step.type === "priority") t.priority = step.value;
                  else t.title = "boom";
                }
              }
            };
            if (batched) batch(apply);
            else apply();
            if (failing()) expect(() => view()).toThrow();
            else expect(ids(view())).toEqual(expected());
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
