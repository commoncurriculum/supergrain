import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  batch,
  computedList,
  createReactive,
  effect,
  unwrap,
  type Group,
  type Lookup,
} from "../../src";

interface User {
  id: string;
  name: string;
  active: boolean;
  teamId?: string;
}
interface Task {
  id: number;
  ownerId: string | null;
  done: boolean;
  rank: number;
  title: string;
}
interface Team {
  id: string;
  name: string;
}

function setup() {
  const store = createReactive({
    users: [
      { id: "a", name: "Ann", active: true, teamId: "x" },
      { id: "b", name: "Bob", active: false, teamId: "y" },
      { id: "c", name: "Cy", active: true },
    ] as User[],
    teams: [
      { id: "x", name: "Red" },
      { id: "y", name: "Blue" },
    ] as Team[],
    tasks: Array.from(
      { length: 12 },
      (_, i): Task => ({
        id: i,
        ownerId: ["a", "b", "c", "zz"][i % 4]!,
        done: i % 3 === 0,
        rank: 12 - i,
        title: `t${i}`,
      }),
    ),
  });
  // The tasks, with users and teams to look up by id.
  const tasks = () =>
    computedList(() => store.tasks, { users: () => store.users, teams: () => store.teams });
  return { store, tasks };
}

type Stored = ReturnType<typeof setup>["store"];
type STask = Stored["tasks"][number];
type SUser = Stored["users"][number];
type STeam = Stored["teams"][number];

const ids = (rows: ReadonlyArray<{ id: number }>) => rows.map((row) => row.id);
const taskIds = (rows: ReadonlyArray<{ task: { id: number } }>) => rows.map((row) => row.task.id);

describe("computedList", () => {
  it("filters, sorts and windows one collection, and returns its docs", () => {
    const { store, tasks } = setup();
    const query = tasks()
      .filter((task) => !task.done)
      .orderBy((task) => task.rank)
      .limit(3);
    expectTypeOf(query()).toEqualTypeOf<ReadonlyArray<STask>>();
    expect(ids(query())).toEqual([11, 10, 8]);
    store.tasks[10]!.done = true;
    expect(ids(query())).toEqual([11, 8, 7]);
    expect(query()[0]).toBe(store.tasks[11]);
  });

  it("sorts by several keys and directions", () => {
    const { tasks } = setup();
    const query = tasks()
      .orderBy((task) => task.ownerId)
      .orderBy((task) => task.id, "desc");
    expect(ids(query())).toEqual([8, 4, 0, 9, 5, 1, 10, 6, 2, 11, 7, 3]);
  });

  it("looks docs up in other collections inside a map", () => {
    const { tasks } = setup();
    const query = tasks()
      .filter((task) => task.id < 4)
      .map((task, { users }) => {
        // A step sees only `get`: keeping a lookup in sync is the list's job.
        expectTypeOf(users).toEqualTypeOf<Lookup<string, SUser>>();
        expectTypeOf(users).not.toHaveProperty("sync");
        return { task, owner: users.get(task.ownerId) };
      });
    expectTypeOf(query()).toEqualTypeOf<ReadonlyArray<{ task: STask; owner: SUser | undefined }>>();
    expect(query().map(({ task, owner }) => [task.id, owner?.name])).toEqual([
      [0, "Ann"],
      [1, "Bob"],
      [2, "Cy"],
      [3, undefined],
    ]);
  });

  it("drops unmatched rows, filters on looked-up docs, and looks up from them again", () => {
    const { store, tasks } = setup();
    const query = tasks()
      .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }))
      .filter((row): row is { task: STask; owner: SUser } => row.owner !== undefined)
      .filter(({ owner }) => owner.active)
      .map((row, { teams }) => ({ ...row, team: teams.get(row.owner.teamId) }))
      .orderBy(({ task }) => task.id)
      .limit(4);
    expectTypeOf(query()).toEqualTypeOf<
      ReadonlyArray<{ task: STask; owner: SUser; team: STeam | undefined }>
    >();
    const view = () =>
      query().map(({ task, owner, team }) => `${task.id}:${owner.name}:${team?.name}`);
    expect(view()).toEqual(["0:Ann:Red", "2:Cy:undefined", "4:Ann:Red", "6:Cy:undefined"]);
    store.users[2]!.teamId = "y";
    expect(view()).toEqual(["0:Ann:Red", "2:Cy:Blue", "4:Ann:Red", "6:Cy:Blue"]);
    store.users[1]!.active = true;
    expect(view()).toEqual(["0:Ann:Red", "1:Bob:Blue", "2:Cy:Blue", "4:Ann:Red"]);
    store.teams.splice(1, 1);
    expect(view()).toEqual(["0:Ann:Red", "1:Bob:undefined", "2:Cy:undefined", "4:Ann:Red"]);
  });

  it("filters and sorts on values a map computed", () => {
    const { store, tasks } = setup();
    const query = tasks()
      .map((task, { users }) => ({
        title: task.title,
        owner: users.get(task.ownerId)?.name ?? "-",
      }))
      .filter((row) => row.owner !== "Bob")
      .orderBy((row) => row.title)
      .limit(3);
    expectTypeOf(query()).toEqualTypeOf<ReadonlyArray<{ title: string; owner: string }>>();
    expect(query()).toEqual([
      { title: "t0", owner: "Ann" },
      { title: "t10", owner: "Cy" },
      { title: "t11", owner: "-" },
    ]);
    store.users[2]!.name = "Cyd";
    expect(query()[1]).toEqual({ title: "t10", owner: "Cyd" });
  });

  it("looks docs up by another key", () => {
    const { store } = setup();
    const query = computedList(() => store.tasks, {
      usersByName: { from: () => store.users, key: (user: User) => user.name },
    })
      .filter((task) => task.id < 2)
      .map((task, { usersByName }) => usersByName.get(task.id === 0 ? "Cy" : "Nobody"));
    expect(query().map((user) => user?.id)).toEqual(["c", undefined]);
  });

  it("follows adds, removes and key changes in every collection", () => {
    const { store, tasks } = setup();
    const query = tasks()
      .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }))
      .filter(({ owner }) => owner !== undefined)
      .orderBy(({ task }) => task.id);
    expect(taskIds(query())).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10]);
    store.users.push({ id: "zz", name: "Zed", active: true });
    expect(taskIds(query())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    store.users[0]!.id = "gone";
    expect(taskIds(query())).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11]);
    store.tasks[1]!.ownerId = "gone";
    store.tasks.push({ id: 12, ownerId: "c", done: false, rank: 0, title: "" });
    store.tasks.splice(2, 1);
    expect(taskIds(query())).toEqual([1, 3, 5, 6, 7, 9, 10, 11, 12]);
    store.tasks[0]!.ownerId = null;
    expect(taskIds(query())).toEqual([1, 3, 5, 6, 7, 9, 10, 11, 12]);
  });

  it("finds the first doc when two share a key", () => {
    const { store, tasks } = setup();
    store.users.push({ id: "a", name: "Second Ann", active: true });
    const query = tasks()
      .filter((task) => task.id === 0)
      .map((task, { users }) => users.get(task.ownerId));
    expect(query()[0]?.name).toBe("Ann");
    store.users.shift();
    expect(query()[0]?.name).toBe("Second Ann");
  });

  it("reruns only the rows that looked up a changed doc, and keeps row identity", () => {
    const { store, tasks } = setup();
    let runs = 0;
    const query = tasks()
      .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }))
      .filter(({ task, owner }) => {
        runs++;
        return owner?.active === true && task.rank < 100;
      });
    const before = [...query()];
    const annRow = query().find(({ task }) => task.id === 0);
    let reads = 0;
    effect(() => {
      query().forEach((row) => row.task);
      reads++;
    });
    runs = reads = 0;
    // No step reads `name`.
    store.users[0]!.name = "Anne";
    expect(query()).toEqual(before);
    expect(runs).toBe(0);
    // Bob owns 3 of the 12 tasks.
    store.users[1]!.active = true;
    expect(runs).toBe(3);
    expect(reads).toBe(1);
    // A new user rebuilds the lookup map but only reruns the rows on its key.
    runs = 0;
    store.users.push({ id: "zz", name: "Zed", active: true });
    query();
    expect(runs).toBe(3);
    // Rows that didn't change keep their output object, even when they rerun.
    expect(query().find(({ task }) => task.id === 0)).toBe(annRow);
    runs = 0;
    store.tasks[0]!.rank = 50;
    expect(runs).toBe(1);
    expect(query().find(({ task }) => task.id === 0)).toBe(annRow);
  });

  it("throws while a key or step throws, and recovers", () => {
    const { store } = setup();
    const query = computedList(() => store.tasks, {
      users: {
        from: () => store.users,
        key: (user: User) => {
          if (user.name === "boom") throw new Error("key");
          return user.name;
        },
      },
    })
      .filter((task) => task.id < 3)
      .map((task, { users }) => users.get(task.ownerId === "a" ? "Ann" : "Cy"));
    expect(query().map((owner) => owner?.name)).toEqual(["Ann", "Cy", "Cy"]);
    store.users[1]!.name = "boom";
    expect(() => query()).toThrow("key");
    store.users[1]!.name = "Bob";
    expect(query().map((owner) => owner?.name)).toEqual(["Ann", "Cy", "Cy"]);
  });

  it("looks up every doc with a key (one-to-many)", () => {
    const { store } = setup();
    const query = computedList(() => store.users, {
      tasks: { from: () => store.tasks, key: (task: Task) => task.ownerId },
    }).map((user, { tasks }) => {
      expectTypeOf(tasks.getAll(user.id)).toEqualTypeOf<ReadonlyArray<STask>>();
      return { user, tasks: tasks.getAll(user.id) };
    });
    const view = () => query().map(({ user, tasks }) => [user.id, ids(tasks)]);
    expect(view()).toEqual([
      ["a", [0, 4, 8]],
      ["b", [1, 5, 9]],
      ["c", [2, 6, 10]],
    ]);
    // The same array for a key every time, updated in place.
    const annTasks = query()[0]!.tasks;
    store.tasks[1]!.ownerId = "a";
    store.tasks.splice(4, 1);
    store.tasks.push({ id: 12, ownerId: "c", done: false, rank: 0, title: "" });
    expect(view()).toEqual([
      ["a", [0, 1, 8]],
      ["b", [5, 9]],
      ["c", [2, 6, 10, 12]],
    ]);
    expect(query()[0]!.tasks).toBe(annTasks);
    store.users.push({ id: "zz", name: "Zed", active: true });
    expect(view()[3]).toEqual(["zz", [3, 7, 11]]);
  });

  it("returns an empty list for a missing key, and fills one no doc had yet", () => {
    const { store } = setup();
    const query = computedList(() => store.users, {
      tasks: { from: () => store.tasks, key: (task: Task) => task.ownerId },
    }).map((user, { tasks }) => ({
      none: tasks.getAll(user.teamId === undefined ? null : undefined),
      nan: tasks.getAll(Number.NaN as never),
      later: tasks.getAll(`${user.id}2`),
    }));
    expect(query()[0]!.none).toEqual([]);
    expect(query()[0]!.nan).toEqual([]);
    expect(query()[0]!.later).toEqual([]);
    store.tasks[0]!.ownerId = "a2";
    expect(ids(query()[0]!.later)).toEqual([0]);
  });

  it("reruns only the rows whose key's docs changed", () => {
    const { store } = setup();
    const runs: string[] = [];
    const query = computedList(() => store.users, {
      tasks: { from: () => store.tasks, key: (task: Task) => task.ownerId },
    }).map((user, { tasks }) => {
      runs.push(user.id);
      return { id: user.id, count: tasks.getAll(user.id).length };
    });
    const counts = () => query().map(({ id, count }) => `${id}:${count}`);
    expect(counts()).toEqual(["a:3", "b:3", "c:3"]);
    runs.length = 0;
    // No key changed.
    store.tasks[0]!.title = "renamed";
    expect(counts()).toEqual(["a:3", "b:3", "c:3"]);
    expect(runs).toEqual([]);
    // A task moves from b to c.
    store.tasks[1]!.ownerId = "c";
    expect(counts()).toEqual(["a:3", "b:2", "c:4"]);
    expect(runs.sort()).toEqual(["b", "c"]);
    runs.length = 0;
    store.tasks.push({ id: 12, ownerId: "a", done: false, rank: 0, title: "" });
    expect(counts()).toEqual(["a:4", "b:2", "c:4"]);
    expect(runs).toEqual(["a"]);
  });

  it("gets the first doc and every doc under one key consistently", () => {
    const { store } = setup();
    const query = computedList(() => store.users, {
      tasks: { from: () => store.tasks, key: (task: Task) => task.ownerId },
    })
      .filter((user) => user.id === "a")
      .map((user, { tasks }) => ({
        first: tasks.get(user.id)?.id,
        all: ids(tasks.getAll(user.id)),
      }));
    expect(query()).toEqual([{ first: 0, all: [0, 4, 8] }]);
    store.tasks.shift();
    expect(query()).toEqual([{ first: 4, all: [4, 8] }]);
    store.tasks[3]!.ownerId = null; // task 4
    expect(query()).toEqual([{ first: 8, all: [8] }]);
  });

  it("recovers every key's docs after a key throws part-way", () => {
    const { store } = setup();
    const query = computedList(() => store.users, {
      tasks: {
        from: () => store.tasks,
        key: (task: Task) => {
          if (task.title === "boom") throw new Error("key");
          return task.ownerId;
        },
      },
    }).map((user, { tasks }) => ids(tasks.getAll(user.id)));
    expect(query()).toEqual([
      [0, 4, 8],
      [1, 5, 9],
      [2, 6, 10],
    ]);
    batch(() => {
      store.tasks[0]!.ownerId = "b";
      store.tasks[5]!.title = "boom";
    });
    expect(() => query()).toThrow("key");
    store.tasks[5]!.title = "t5";
    expect(query()).toEqual([
      [4, 8],
      [0, 1, 5, 9],
      [2, 6, 10],
    ]);
  });

  it("groups rows by a key, and runs the steps after it once per group", () => {
    const { tasks } = setup();
    const query = tasks()
      .filter((task) => !task.done)
      .groupBy((task) => task.ownerId)
      .map((group) => {
        expectTypeOf(group).toEqualTypeOf<Group<string | null, STask>>();
        return { owner: group.key, ids: ids(group.rows) };
      });
    // Groups in the order of their first row; rows in source order.
    expect(query()).toEqual([
      { owner: "b", ids: [1, 5] },
      { owner: "c", ids: [2, 10] },
      { owner: "a", ids: [4, 8] },
      { owner: "zz", ids: [7, 11] },
    ]);
  });

  it("follows rows that move between groups, and groups that empty or appear", () => {
    const { store, tasks } = setup();
    const query = tasks()
      .groupBy((task) => task.ownerId)
      .map((group) => `${group.key}:${ids(group.rows).join(",")}`);
    expect(query()).toEqual(["a:0,4,8", "b:1,5,9", "c:2,6,10", "zz:3,7,11"]);
    store.tasks[0]!.ownerId = "b";
    expect(query()).toEqual(["b:0,1,5,9", "c:2,6,10", "zz:3,7,11", "a:4,8"]);
    for (const task of store.tasks) if (task.ownerId === "c") task.ownerId = "zz";
    expect(query()).toEqual(["b:0,1,5,9", "zz:2,3,6,7,10,11", "a:4,8"]);
    store.tasks.push({ id: 12, ownerId: "new", done: false, rank: 0, title: "" });
    store.tasks.unshift({ id: 13, ownerId: "first", done: false, rank: 0, title: "" });
    expect(query()).toEqual(["first:13", "b:0,1,5,9", "zz:2,3,6,7,10,11", "a:4,8", "new:12"]);
    store.tasks.reverse();
    expect(query()).toEqual(["new:12", "zz:11,10,7,6,3,2", "b:9,5,1,0", "a:8,4", "first:13"]);
  });

  it("reruns only the groups whose rows changed", () => {
    const { store, tasks } = setup();
    const runs: Array<string | null> = [];
    const query = tasks()
      .groupBy((task) => task.ownerId)
      .map((group) => {
        runs.push(group.key);
        return { owner: group.key, open: group.rows.filter((task) => !task.done).length };
      });
    const view = () => query().map(({ owner, open }) => `${owner}:${open}`);
    expect(view()).toEqual(["a:2", "b:2", "c:2", "zz:2"]);
    runs.length = 0;
    store.tasks[1]!.title = "renamed";
    expect(view()).toEqual(["a:2", "b:2", "c:2", "zz:2"]);
    expect(runs).toEqual([]);
    store.tasks[1]!.done = true;
    expect(view()).toEqual(["a:2", "b:1", "c:2", "zz:2"]);
    expect(runs).toEqual(["b"]);
    runs.length = 0;
    // c's first row is now task 6, after zz's first (task 3).
    store.tasks[2]!.ownerId = "a";
    expect(view()).toEqual(["a:3", "b:1", "zz:2", "c:1"]);
    expect(runs.sort()).toEqual(["a", "c"]);
  });

  it("drops a row from its group when rows before it left the source too", () => {
    // Read through `filter`, the source is walked each time, which labels
    // the rows that stay again from 0, while one that left keeps its label.
    const store = createReactive({
      items: [..."oooooRS"].map((k, id) => ({ id, k: k === "o" ? "o" : "k", show: true })),
    });
    const query = computedList(() => store.items.filter((item) => item.show))
      .groupBy((item) => item.k)
      .map((group) => [group.key, group.rows.map((item) => item.id)]);
    expect(query()).toEqual([
      ["o", [0, 1, 2, 3, 4]],
      ["k", [5, 6]],
    ]);
    batch(() => {
      for (let i = 0; i < 6; i++) store.items[i]!.show = false;
    });
    expect(query()).toEqual([["k", [6]]]);
  });

  it("keeps null, undefined and NaN as keys of their own", () => {
    const store = createReactive({
      items: [null, undefined, Number.NaN, null, Number.NaN].map((k) => ({ k, n: 0 })),
    });
    const query = computedList(() => store.items)
      .groupBy((item) => item.k)
      .map((group) => [group.key, group.rows.length]);
    const expected = [
      [null, 2],
      [undefined, 1],
      [Number.NaN, 2],
    ];
    expect(query()).toEqual(expected);
    // A row that reruns with the same NaN key stays where it is.
    store.items[2]!.n = 1;
    expect(query()).toEqual(expected);
  });

  it("filters, sorts and windows the groups, and looks docs up on both sides", () => {
    const { store, tasks } = setup();
    const query = tasks()
      .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }))
      .filter(({ owner }) => owner !== undefined)
      .groupBy(({ owner }) => owner!.teamId)
      .map((group, { teams }) => ({
        team: teams.get(group.key)?.name ?? "-",
        count: group.rows.length,
      }))
      .filter(({ count }) => count > 0)
      .orderBy(({ count }) => count, "desc")
      .orderBy(({ team }) => team)
      .limit(2);
    expect(query()).toEqual([
      { team: "-", count: 3 },
      { team: "Blue", count: 3 },
    ]);
    store.users[2]!.teamId = "x";
    expect(query()).toEqual([
      { team: "Red", count: 6 },
      { team: "Blue", count: 3 },
    ]);
    store.teams[0]!.name = "Crimson";
    expect(query()[0]).toEqual({ team: "Crimson", count: 6 });
  });

  it("groups groups", () => {
    const { tasks } = setup();
    const query = tasks()
      .groupBy((task) => task.ownerId)
      .groupBy((group) => group.rows.length)
      .map((sizes) => [sizes.key, sizes.rows.map((group) => group.key)]);
    expect(query()).toEqual([[3, ["a", "b", "c", "zz"]]]);
  });

  it("throws while a key or a step before groupBy throws, and recovers", () => {
    const { store, tasks } = setup();
    const query = tasks()
      .filter((task) => {
        if (task.title === "boom") throw new Error("step");
        return true;
      })
      .groupBy((task) => {
        if (task.title === "bang") throw new Error("key");
        return task.ownerId;
      })
      .map((group) => group.rows.length);
    expect(query()).toEqual([3, 3, 3, 3]);
    batch(() => {
      store.tasks[0]!.ownerId = "b";
      store.tasks[5]!.title = "boom";
    });
    expect(() => query()).toThrow("step");
    store.tasks[5]!.title = "bang";
    expect(() => query()).toThrow("key");
    store.tasks[5]!.title = "t5";
    expect(query()).toEqual([4, 3, 3, 2]);
  });

  it("reuses a mapped object only when it's a plain object with the same fields", () => {
    const { store } = setup();
    class Box {
      constructor(readonly id: number) {}
    }
    const shapes = computedList(() => store.tasks)
      .filter((task) => task.id === 1)
      .map((task) => (task.done ? { id: task.id, done: true } : { id: task.id }));
    const nullProto = computedList(() => store.tasks)
      .filter((task) => task.id === 1)
      .map((task) =>
        Object.assign(Object.create(null) as { id: number }, {
          id: task.id,
          done: task.done && false,
        }),
      );
    const boxes = computedList(() => store.tasks)
      .filter((task) => task.id === 1)
      .map((task) => (task.done, new Box(task.id)));
    const [shape, bare, box] = [shapes()[0], nullProto()[0], boxes()[0]];
    // Each map reads `done`, so each reruns.
    store.tasks[1]!.done = true;
    expect(shapes()[0]).not.toBe(shape);
    expect(shapes()[0]).toEqual({ id: 1, done: true });
    store.tasks[1]!.done = false;
    expect(shapes()[0]).toEqual({ id: 1 });
    expect(nullProto()[0]).toBe(bare);
    // A class instance isn't compared field by field: each rerun is a new row.
    expect(boxes()[0]).not.toBe(box);
  });

  it("doesn't reuse a mapped object whose fields are other names with the same count", () => {
    const { store } = setup();
    const rows = computedList(() => store.tasks)
      .filter((task) => task.id === 1)
      .map((task): { a?: undefined; b?: number } => (task.done ? { a: undefined } : { b: 1 }));
    expect(rows()[0]).toEqual({ b: 1 });
    store.tasks[1]!.done = true;
    expect(rows()[0]).toEqual({ a: undefined });
  });

  it("keeps a row's key when array or missing key parts order the same", () => {
    const { store } = setup();
    const rows = computedList(() => store.tasks)
      .filter((task) => task.id < 3)
      .orderBy((task) => (task.id === 2 ? null : [task.rank, task.ownerId]));
    const ids = () => rows().map((task) => task.id);
    expect(ids()).toEqual([1, 0, 2]);
    // A rerun that leaves every key part the same keeps the row in place.
    store.tasks[0]!.title = "renamed";
    store.tasks[2]!.title = "renamed";
    expect(ids()).toEqual([1, 0, 2]);
    store.tasks[0]!.rank = 0;
    expect(ids()).toEqual([0, 1, 2]);
  });

  it("never reuses a mapped row whose fields include a symbol key", () => {
    const label = Symbol("label");
    const store = createReactive({ items: [{ id: 1, title: "a" }] });
    const rows = computedList(() => store.items).map((item) => ({ [label]: item.title }));
    expect(rows()[0]![label]).toBe("a");
    store.items[0]!.title = "b";
    expect(rows()[0]![label]).toBe("b");
    // A previous row with a symbol, and a next one without.
    const mixed = computedList(() => store.items).map((item) =>
      item.title === "b" ? { [label]: 1 } : {},
    );
    expect(label in mixed()[0]!).toBe(true);
    store.items[0]!.title = "c";
    expect(label in mixed()[0]!).toBe(false);
  });

  it("follows a store array used as a sort key", () => {
    const store = createReactive({
      items: [
        { id: 1, path: [2, 0] },
        { id: 2, path: [1, 5] },
        { id: 3, path: [3] },
      ],
    });
    const rows = computedList(() => store.items).orderBy((item) => item.path);
    const ids = () => rows().map((item) => item.id);
    expect(ids()).toEqual([2, 1, 3]);
    store.items[1]!.path[0] = 4;
    expect(ids()).toEqual([1, 3, 2]);
    store.items[2]!.path.push(1);
    store.items[0]!.path.length = 1;
    expect(ids()).toEqual([1, 3, 2]);
    store.items[2]!.path[0] = 0;
    expect(ids()).toEqual([3, 1, 2]);
  });

  it("recovers when comparing keys throws after some rows were filed", () => {
    let boom = false;
    const key = (n: number) => ({
      valueOf() {
        if (boom) throw new Error("boom");
        return n;
      },
    });
    const store = createReactive({
      items: [1, 2, 3, 4].map((id) => ({ id, show: id < 3, rank: key(id) })),
      limit: 10,
    });
    const rows = computedList(() => store.items)
      .filter((item) => item.show)
      .orderBy((item) => item.rank as unknown as number)
      .limit(() => store.limit);
    const ids = () => rows().map((item) => item.id);
    expect(ids()).toEqual([1, 2]);
    boom = true;
    batch(() => {
      store.items[2]!.show = true;
      store.items[3]!.show = true;
    });
    expect(() => rows()).toThrow("boom");
    boom = false;
    // Rerun the list without rerunning any row: the rows filed before the
    // throw must not be filed twice.
    store.limit = 9;
    expect(ids()).toEqual([1, 2, 3, 4]);
  });

  it("recovers when the window bound throws after the rows were read", () => {
    const store = createReactive({
      items: Array.from({ length: 40 }, (_, id) => ({ id, rank: id })),
      limit: 3 as number | null,
    });
    const rows = computedList(() => store.items)
      .orderBy((item) => item.rank)
      .limit(() => {
        if (store.limit === null) throw new Error("limit");
        return store.limit;
      });
    const ids = () => rows().map((item) => item.id);
    expect(ids()).toEqual([0, 1, 2]);
    // Rows in two block groups change, then the bound throws before they are filed.
    batch(() => {
      store.items[39]!.rank = -2;
      store.items[1]!.rank = 100;
      store.limit = null;
    });
    expect(() => rows()).toThrow("limit");
    store.items[38]!.rank = -1;
    store.limit = 4;
    expect(ids()).toEqual([39, 38, 0, 2]);
  });

  it("follows a reverse of a very large array", () => {
    const count = 200_000;
    const store = createReactive({ items: Array.from({ length: count }, (_, id) => ({ id })) });
    const firstThree = computedList(() => store.items).limit(3);
    expect(firstThree().map((item) => item.id)).toEqual([0, 1, 2]);
    store.items.reverse();
    expect(firstThree().map((item) => item.id)).toEqual([count - 1, count - 2, count - 3]);
  });

  it("reads any window number the way Array.slice does, fixed or reactive", () => {
    const store = createReactive({
      items: [1, 2, 3, 4, 5].map((id) => ({ id })),
      offset: 0,
      limit: 0,
    });
    const count = (value: number) => Math.max(0, Math.trunc(value) || 0);
    for (const [offset, limit] of [
      [1.5, 2.5],
      [-1, 2],
      [0, -3],
      [Number.NaN, 2],
      [1, Number.NaN],
      [-Infinity, Infinity],
    ] as const) {
      store.offset = offset;
      store.limit = limit;
      const expected = store.items
        .slice(count(offset), count(offset) + count(limit))
        .map((item) => item.id);
      const sorted = computedList(() => store.items).orderBy((item) => item.id);
      const unsorted = computedList(() => store.items);
      for (const list of [sorted, unsorted]) {
        expect(
          list
            .offset(offset)
            .limit(limit)()
            .map((item) => item.id),
        ).toEqual(expected);
        const reactive = list.offset(() => store.offset).limit(() => store.limit);
        expect(reactive().map((item) => item.id)).toEqual(expected);
      }
    }
  });

  it("windows with a reactive offset and limit", () => {
    const { tasks } = setup();
    const window = createReactive({ offset: 1, limit: 2 });
    const query = tasks()
      .orderBy((task) => task.id)
      .offset(() => window.offset)
      .limit(() => window.limit);
    expect(ids(query())).toEqual([1, 2]);
    window.offset = 5;
    expect(ids(query())).toEqual([5, 6]);
  });

  it("updates rows that looked up a missing key once a doc gets that key", () => {
    const { store, tasks } = setup();
    store.tasks.push(
      ...Array.from({ length: 200 }, (_, i) => ({
        id: 100 + i,
        ownerId: `k${i}`,
        done: false,
        rank: 0,
        title: "",
      })),
    );
    const query = tasks()
      .filter((task) => task.id >= 100)
      .map((task, { users }) => users.get(task.ownerId)?.name);
    expect(query().filter(Boolean)).toEqual([]);
    store.users.push({ id: "other", name: "Other", active: true });
    store.users.push({ id: "k99", name: "Kay", active: true });
    expect(query().filter(Boolean)).toEqual(["Kay"]);
  });

  it("joins by reading a keyed store, with no lookups declared", () => {
    const { store } = setup();
    const keyed = createReactive({
      usersById: Object.fromEntries(unwrap(store.users).map((u) => [u.id, { ...u }])) as Record<
        string,
        User | undefined
      >,
    });
    let runs = 0;
    const query = computedList(() => store.tasks)
      .map((task) => {
        runs++;
        return { task, owner: keyed.usersById[task.ownerId ?? ""] };
      })
      .filter(({ owner }) => owner?.active === true)
      .orderBy(({ task }) => task.id);
    expect(taskIds(query())).toEqual([0, 2, 4, 6, 8, 10]);
    runs = 0;
    keyed.usersById["b"]!.active = true;
    expect(taskIds(query())).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10]);
    // Each row's steps run in one computed: Bob's 3 rows reran, no others.
    expect(runs).toBe(3);
    runs = 0;
    keyed.usersById["zz"] = { id: "zz", name: "Zed", active: true };
    expect(taskIds(query())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(runs).toBe(3);
  });

  it("looks docs up in a list derived inside the query", () => {
    const { store } = setup();
    const query = computedList(() => store.tasks, {
      activeUsers: () => store.users.filter((user) => user.active),
    })
      .filter((task) => task.id < 4)
      .map((task, { activeUsers }) => activeUsers.get(task.ownerId)?.name);
    expect(query()).toEqual(["Ann", undefined, "Cy", undefined]);
    store.users[1]!.active = true;
    expect(query()).toEqual(["Ann", "Bob", "Cy", undefined]);
    store.users[0]!.active = false;
    expect(query()).toEqual([undefined, "Bob", "Cy", undefined]);
  });
});

describe("queries match a from-scratch reference across three collections", () => {
  type Op =
    | { type: "taskOwner"; index: number; owner: number }
    | { type: "taskDone"; index: number }
    | { type: "taskRank"; index: number; rank: number }
    | { type: "addTask"; owner: number; rank: number }
    | { type: "removeTask"; index: number }
    | { type: "moveTask"; index: number; to: number }
    | { type: "reverseTasks" }
    | { type: "userActive"; index: number }
    | { type: "userTeam"; index: number; team: number }
    | { type: "userId"; index: number; id: number }
    | { type: "addUser"; id: number; team: number }
    | { type: "removeUser"; index: number }
    | { type: "teamName"; index: number; name: number }
    | { type: "removeTeam"; index: number }
    | { type: "addTeam"; id: number; name: number };

  const index = fc.nat({ max: 100 });
  const small = fc.nat({ max: 6 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ type: fc.constant("taskOwner" as const), index, owner: small }),
    fc.record({ type: fc.constant("taskDone" as const), index }),
    fc.record({ type: fc.constant("taskRank" as const), index, rank: small }),
    fc.record({ type: fc.constant("addTask" as const), owner: small, rank: small }),
    fc.record({ type: fc.constant("removeTask" as const), index }),
    fc.record({ type: fc.constant("moveTask" as const), index, to: index }),
    fc.record({ type: fc.constant("reverseTasks" as const) }),
    fc.record({ type: fc.constant("userActive" as const), index }),
    fc.record({ type: fc.constant("userTeam" as const), index, team: small }),
    fc.record({ type: fc.constant("userId" as const), index, id: small }),
    fc.record({ type: fc.constant("addUser" as const), id: small, team: small }),
    fc.record({ type: fc.constant("removeUser" as const), index }),
    fc.record({ type: fc.constant("teamName" as const), index, name: small }),
    fc.record({ type: fc.constant("removeTeam" as const), index }),
    fc.record({ type: fc.constant("addTeam" as const), id: small, name: small }),
  );

  it("after every step, keeping or dropping unmatched rows, sorted or not", () => {
    fc.assert(
      fc.property(
        fc.array(op, { maxLength: 40 }),
        fc.boolean(),
        fc.boolean(),
        (ops, inner, sorted) => {
          let nextTask = 0;
          const store = createReactive({
            users: Array.from({ length: 4 }, (_, i) => ({
              id: `u${i}`,
              name: "",
              active: i % 2 === 0,
              teamId: `g${i % 3}`,
            })) as User[],
            teams: Array.from({ length: 3 }, (_, i) => ({ id: `g${i}`, name: `n${i}` })) as Team[],
            tasks: Array.from(
              { length: 30 },
              (_, i): Task => ({
                id: nextTask++,
                ownerId: `u${i % 6}`,
                done: i % 4 === 0,
                rank: i % 5,
                title: "",
              }),
            ),
          });
          const joined = computedList(() => store.tasks, {
            users: () => store.users,
            teams: () => store.teams,
          })
            .filter((task) => !task.done)
            .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }))
            .filter(({ owner }) => owner === undefined || owner.active)
            .map((row, { teams }) => ({ ...row, team: teams.get(row.owner?.teamId) }))
            .filter(({ team }) => !inner || team !== undefined)
            .map(({ task, team }) => ({ id: task.id, rank: task.rank, team: team?.name ?? "-" }));
          const query = sorted
            ? joined
                .orderBy((row) => row.team)
                .orderBy((row) => row.rank, "desc")
                .orderBy((row) => row.id)
            : joined;

          const expected = () => {
            const users = unwrap(store.users);
            const teams = unwrap(store.teams);
            const user = (id: string | null) => users.find((u) => u.id === id);
            const team = (id: string | undefined) => teams.find((t) => t.id === id);
            const rows = unwrap(store.tasks)
              .filter((task) => !task.done)
              .map((task) => ({ task, owner: user(task.ownerId) }))
              .filter(({ owner }) => owner === undefined || owner.active)
              .map((row) => ({ ...row, team: team(row.owner?.teamId) }))
              .filter(({ team }) => !inner || team !== undefined)
              .map(({ task, team }) => ({ id: task.id, rank: task.rank, team: team?.name ?? "-" }));
            if (sorted)
              rows.sort((a, b) =>
                a.team < b.team ? -1 : a.team > b.team ? 1 : b.rank - a.rank || a.id - b.id,
              );
            return rows;
          };
          // One-to-many, the other way: each active user's open tasks.
          const owned = computedList(() => store.users, {
            tasks: { from: () => store.tasks, key: (task: Task) => task.ownerId },
          })
            .filter((user) => user.active)
            .map((user, { tasks }) => ({
              id: user.id,
              open: tasks
                .getAll(user.id)
                .filter((task) => !task.done)
                .map((task) => task.id),
            }));
          const expectedOwned = () =>
            unwrap(store.users)
              .filter((user) => user.active)
              .map((user) => ({
                id: user.id,
                open: unwrap(store.tasks)
                  .filter((task) => task.ownerId === user.id && !task.done)
                  .map((task) => task.id),
              }));
          // The open tasks of each owner, grouped.
          const grouped = computedList(() => store.tasks)
            .filter((task) => !task.done)
            .groupBy((task) => task.ownerId)
            .map((group) => ({ key: group.key, ids: group.rows.map((task) => task.id) }));
          const expectedGrouped = () => {
            const groups = new Map<string | null, number[]>();
            for (const task of unwrap(store.tasks)) {
              if (task.done) continue;
              const list = groups.get(task.ownerId) ?? [];
              list.push(task.id);
              groups.set(task.ownerId, list);
            }
            return Array.from(groups, ([key, ids]) => ({ key, ids }));
          };
          const at = <T>(list: T[], i: number) => (list.length ? list[i % list.length] : undefined);

          for (const step of ops) {
            batch(() => {
              const { tasks, users, teams } = store;
              const task = "index" in step ? at(tasks, step.index) : undefined;
              const user = "index" in step ? at(users, step.index) : undefined;
              const team = "index" in step ? at(teams, step.index) : undefined;
              if (step.type === "taskOwner" && task) task.ownerId = `u${step.owner}`;
              else if (step.type === "taskDone" && task) task.done = !task.done;
              else if (step.type === "taskRank" && task) task.rank = step.rank;
              else if (step.type === "addTask")
                tasks.push({
                  id: nextTask++,
                  ownerId: `u${step.owner}`,
                  done: false,
                  rank: step.rank,
                  title: "",
                });
              else if (step.type === "removeTask" && tasks.length)
                tasks.splice(step.index % tasks.length, 1);
              else if (step.type === "moveTask" && tasks.length) {
                const [moved] = tasks.splice(step.index % tasks.length, 1);
                tasks.splice(step.to % (tasks.length + 1), 0, moved!);
              } else if (step.type === "reverseTasks") tasks.reverse();
              else if (step.type === "userActive" && user) user.active = !user.active;
              else if (step.type === "userTeam" && user) user.teamId = `g${step.team}`;
              else if (step.type === "userId" && user) user.id = `u${step.id}`;
              else if (step.type === "addUser")
                users.push({ id: `u${step.id}`, name: "", active: true, teamId: `g${step.team}` });
              else if (step.type === "removeUser" && users.length)
                users.splice(step.index % users.length, 1);
              else if (step.type === "teamName" && team) team.name = `n${step.name}`;
              else if (step.type === "removeTeam" && teams.length)
                teams.splice(step.index % teams.length, 1);
              else if (step.type === "addTeam")
                teams.push({ id: `g${step.id}`, name: `n${step.name}` });
            });
            expect(query().map((row) => ({ ...row }))).toEqual(expected());
            expect(owned().map((row) => ({ ...row }))).toEqual(expectedOwned());
            expect(grouped().map((row) => ({ ...row }))).toEqual(expectedGrouped());
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
