import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";

import { batch, computedList, createReactive, effect, unwrap } from "../../src";

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
      .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }));
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
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
