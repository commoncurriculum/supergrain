import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";

import { batch, createReactive, effect, from, indexBy, unwrap } from "../../src";

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
  const usersById = indexBy(
    () => store.users,
    (user) => user.id,
  );
  const teamsById = indexBy(
    () => store.teams,
    (team) => team.id,
  );
  return { store, usersById, teamsById };
}

type Stored = ReturnType<typeof setup>["store"];
type STask = Stored["tasks"][number];
type SUser = Stored["users"][number];
type STeam = Stored["teams"][number];

const ids = (rows: ReadonlyArray<{ id: number }>) => rows.map((row) => row.id);
const taskIds = (rows: ReadonlyArray<{ task: { id: number } }>) => rows.map((row) => row.task.id);

describe("from", () => {
  it("filters, sorts and windows one collection, and returns its items", () => {
    const { store } = setup();
    const query = from({ task: () => store.tasks })
      .where(({ task }) => !task.done)
      .orderBy(({ task }) => task.rank)
      .limit(3);
    expectTypeOf(query()).toEqualTypeOf<ReadonlyArray<STask>>();
    expect(ids(query())).toEqual([11, 10, 8]);
    store.tasks[10]!.done = true;
    expect(ids(query())).toEqual([11, 8, 7]);
    expect(query()[0]).toBe(store.tasks[11]);
  });

  it("sorts by several keys and directions", () => {
    const { store } = setup();
    const query = from({ task: () => store.tasks })
      .orderBy(({ task }) => task.ownerId)
      .orderBy(({ task }) => task.id, "desc");
    expect(ids(query())).toEqual([8, 4, 0, 9, 5, 1, 10, 6, 2, 11, 7, 3]);
  });

  it("left-joins: the field is undefined when nothing matches", () => {
    const { store, usersById } = setup();
    const query = from({ task: () => store.tasks })
      .where(({ task }) => task.id < 4)
      .join({ owner: usersById }, ({ task }) => task.ownerId);
    expectTypeOf(query()).toEqualTypeOf<ReadonlyArray<{ task: STask; owner: SUser | undefined }>>();
    expect(query().map(({ task, owner }) => [task.id, owner?.name])).toEqual([
      [0, "Ann"],
      [1, "Bob"],
      [2, "Cy"],
      [3, undefined],
    ]);
  });

  it("inner-joins, filters on the joined doc, and joins again from it", () => {
    const { store, usersById, teamsById } = setup();
    const query = from({ task: () => store.tasks })
      .join({ owner: usersById }, ({ task }) => task.ownerId, "inner")
      .where(({ owner }) => owner.active)
      .join({ team: teamsById }, ({ owner }) => owner.teamId)
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

  it("maps rows, and looks docs up inside a map", () => {
    const { store, usersById } = setup();
    const query = from({ task: () => store.tasks })
      .map(({ task }) => ({ title: task.title, owner: usersById.get(task.ownerId)?.name ?? "-" }))
      .where((row) => row.owner !== "Bob")
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

  it("follows adds, removes and key changes on both sides", () => {
    const { store, usersById } = setup();
    const query = from({ task: () => store.tasks })
      .join({ owner: usersById }, ({ task }) => task.ownerId, "inner")
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

  it("uses the first doc when two share a key", () => {
    const { store, usersById } = setup();
    store.users.push({ id: "a", name: "Second Ann", active: true });
    const query = from({ task: () => store.tasks })
      .where(({ task }) => task.id === 0)
      .join({ owner: usersById }, ({ task }) => task.ownerId);
    expect(query()[0]!.owner?.name).toBe("Ann");
    store.users.shift();
    expect(query()[0]!.owner?.name).toBe("Second Ann");
  });

  it("reruns only the rows joined to a changed doc, and keeps row identity", () => {
    const { store, usersById } = setup();
    let runs = 0;
    const query = from({ task: () => store.tasks })
      .join({ owner: usersById }, ({ task }) => task.ownerId)
      .where(({ task, owner }) => {
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
    // A new user rebuilds the index but only reruns the rows on its key.
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
    const byName = indexBy(
      () => store.users,
      (user) => {
        if (user.name === "boom") throw new Error("key");
        return user.name;
      },
    );
    const query = from({ task: () => store.tasks })
      .where(({ task }) => task.id < 3)
      .join({ owner: byName }, ({ task }) => (task.ownerId === "a" ? "Ann" : "Cy"));
    expect(query().map(({ owner }) => owner?.name)).toEqual(["Ann", "Cy", "Cy"]);
    store.users[1]!.name = "boom";
    expect(() => query()).toThrow("key");
    store.users[1]!.name = "Bob";
    expect(query().map(({ owner }) => owner?.name)).toEqual(["Ann", "Cy", "Cy"]);
  });

  it("windows with a reactive offset and limit", () => {
    const { store } = setup();
    const window = createReactive({ offset: 1, limit: 2 });
    const query = from({ task: () => store.tasks })
      .orderBy(({ task }) => task.id)
      .offset(() => window.offset)
      .limit(() => window.limit);
    expect(ids(query())).toEqual([1, 2]);
    window.offset = 5;
    expect(ids(query())).toEqual([5, 6]);
  });

  it("forgets lookups for missing keys, and readers of them still update", () => {
    const { store, usersById } = setup();
    const seen: Array<string | undefined> = [];
    effect(() => {
      seen.push(usersById.get("k99")?.name);
    });
    for (let i = 0; i < 200; i++) usersById.get(`k${i}`);
    // Rebuilding the index forgets the 200 lookups.
    store.users.push({ id: "other", name: "Other", active: true });
    store.users.push({ id: "k99", name: "Kay", active: true });
    expect(seen).toEqual([undefined, "Kay"]);
    expect(usersById.get("k99")?.name).toBe("Kay");
  });

  it("takes exactly one collection and one index", () => {
    const { store, usersById } = setup();
    expect(() => from({ a: () => store.tasks, b: () => store.tasks })).toThrow(TypeError);
    expect(() =>
      from({ task: () => store.tasks }).join(
        { a: usersById, b: usersById },
        ({ task }) => task.ownerId,
      ),
    ).toThrow(TypeError);
  });
});

describe("from matches a from-scratch reference across three collections", () => {
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

  it("after every step, left or inner, sorted or not", () => {
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
          const usersById = indexBy(
            () => store.users,
            (user) => user.id,
          );
          const teamsById = indexBy(
            () => store.teams,
            (team) => team.id,
          );
          let query = from({ task: () => store.tasks })
            .where(({ task }) => !task.done)
            .join({ owner: usersById }, ({ task }) => task.ownerId)
            .where(({ owner }) => owner === undefined || owner.active)
            .join({ team: teamsById }, ({ owner }) => owner?.teamId, inner ? "inner" : "left")
            .map(({ task, team }) => ({ id: task.id, rank: task.rank, team: team?.name ?? "-" }));
          if (sorted)
            query = query
              .orderBy((row) => row.team)
              .orderBy((row) => row.rank, "desc")
              .orderBy((row) => row.id) as never;

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
