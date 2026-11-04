import { createLiveQueryCollection, type Collection } from "@tanstack/db";
import { bench, describe } from "vitest";

import {
  computedListTopTen,
  joinScenarios,
  oneToManyScenarios,
  groupScenarios,
  stableComputedCountsByOwner,
  supergrainCountsByOwner,
  tanstackCountsByOwner,
  type CountsByOwner,
  stableComputedOpenTasksByUser,
  supergrainOpenTasksByUser,
  supergrainOpenTasksByUserFromList,
  tanstackOpenTasksByUser,
  type OpenTasksByUser,
  joinValidationChanges,
  makeOwnedTasks,
  makeUsers,
  stableComputedJoined,
  supergrainJoined,
  supergrainJoinStore,
  tanstackJoin,
  tanstackJoinedTopTen,
  type JoinChange,
  type JoinedList,
  type Owned,
  type User,
  makeTasks,
  membershipScenarios,
  scenarios,
  stableComputedTopTen,
  supergrainStore,
  tanstackOptimisticUpdate,
  tanstackSyncWrite,
  tanstackTopTen,
  validationEdits,
  type Edit,
  type Membership,
  type SupergrainList,
  type Task,
  type TanstackTasks,
} from "./computed-list-fixtures";

/**
 * `computedList` vs `stableComputed` vs TanStack DB 1.0 RC1 live queries, with
 * no UI. `react/computed-list.bench.tsx` runs the same comparison rendered by
 * React.
 *
 * Each benchmark is one change followed by one read of the result, the way a
 * UI would see it. TanStack DB runs two ways (see `computed-list-fixtures.ts`):
 * "sync write" (server data) and "optimistic update" (a user edit). Both get
 * the B-tree indexes TanStack DB asks for.
 *
 * Before timing, every implementation runs the same edits and must return the
 * same rows, so the numbers compare equal work.
 */

/**
 * Wait for work a write queued for later. TanStack DB finishes some updates in
 * microtasks (loading more rows for an ordered, limited query), so timing only
 * the synchronous call would leave that work out. Every implementation waits
 * the same way, so the wait itself adds the same small cost to each.
 */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Bench one kind of change: `build` makes a fresh harness right before the
 * warmup and again before the timed run, and the harness is dropped after
 * each. Building every harness up front, while the benches are collected,
 * would keep all of them alive at once, and the large heap that leaves slows
 * every bench through the garbage collector.
 */
function benchChanges<H extends { read(): unknown; dispose(): void }>(
  name: string,
  build: () => H,
  step: (harness: H, i: number) => void,
): void {
  let harness: H | undefined;
  let i = 0;
  bench(
    name,
    async () => {
      step(harness!, i++);
      await settled();
      harness!.read();
    },
    {
      setup: () => {
        harness = build();
        harness.read();
        i = 0;
      },
      teardown: () => {
        harness?.dispose();
        harness = undefined;
      },
    },
  );
}

/**
 * Check that every implementation shows the same thing after each step,
 * waiting for queued work after each write, as the timed benches do.
 */
async function expectAgreement<H extends { dispose(): void }>(
  what: string,
  implementations: ReadonlyArray<readonly [string, () => H]>,
  read: (harness: H) => unknown,
  steps: ReadonlyArray<(harness: H) => void>,
): Promise<void> {
  const results: Array<readonly [string, string]> = [];
  for (const [name, build] of implementations) {
    const harness = build();
    await settled();
    const seen = [read(harness)];
    for (const step of steps) {
      step(harness);
      await settled();
      seen.push(read(harness));
    }
    harness.dispose();
    results.push([name, JSON.stringify(seen)]);
  }
  for (const [name, seen] of results) {
    if (seen !== results[0]![1]) {
      throw new Error(`computed-list bench: ${name} disagrees with ${results[0]![0]} at ${what}`);
    }
  }
}

/** What every implementation can do: edit, add and remove rows, and read the top 10 ids. */
interface Harness {
  read(): number[];
  edit(changes: Edit): void;
  change(change: Membership): void;
  dispose(): void;
}

type Build = (tasks: Task[]) => Harness;

const ids = (rows: Iterable<{ id: number }>) => Array.from(rows, (row) => row.id);

function supergrain(makeList: SupergrainList): Build {
  return (tasks) => {
    const { store, edit, change } = supergrainStore(tasks);
    const list = makeList(store);
    return { read: () => ids(list()), edit, change, dispose: () => {} };
  };
}

/**
 * Keep a live query alive the way a UI would, by subscribing to it. A live
 * query nobody subscribes to is garbage-collected after 5 seconds (TanStack
 * DB's default `gcTime`); after that it reads empty and does no work, so a
 * bench reading it would time nothing. Reading a collected query throws.
 */
function watch<T extends object>(query: Collection<T>): { values(): Iterable<T>; stop(): void } {
  const subscription = query.subscribeChanges(() => {});
  return {
    values: () => {
      if (query.status === "cleaned-up")
        throw new Error("computed-list bench: live query was collected");
      return query.values();
    },
    stop: () => {
      subscription.unsubscribe();
      void query.cleanup();
    },
  };
}

function tanstack(setup: (tasks: Task[]) => TanstackTasks): Build {
  return (tasks) => {
    const { collection, edit, change, dispose } = setup(tasks);
    const query = watch(
      createLiveQueryCollection({
        startSync: true,
        query: (q) => tanstackTopTen(q, collection),
      }),
    );
    return {
      read: () => ids(query.values()),
      edit,
      change,
      dispose: () => {
        query.stop();
        dispose();
      },
    };
  };
}

const IMPLEMENTATIONS: ReadonlyArray<[string, Build]> = [
  ["supergrain computedList", supergrain(computedListTopTen)],
  ["supergrain stableComputed", supergrain(stableComputedTopTen)],
  ["TanStack DB (sync write)", tanstack(tanstackSyncWrite)],
  ["TanStack DB (optimistic update)", tanstack(tanstackOptimisticUpdate)],
];

/** Run the same edits on every implementation; throw if any result differs. */
function validate(size: number): Promise<void> {
  const membership = membershipScenarios(size).flatMap(([, change]) => [change(0), change(1)]);
  return expectAgreement(
    `${size} rows`,
    IMPLEMENTATIONS.map(([name, build]) => [name, () => build(makeTasks(size))] as const),
    (harness) => harness.read(),
    [
      ...validationEdits(size).map((edit) => (harness: Harness) => harness.edit(edit)),
      ...membership.map((change) => (harness: Harness) => harness.change(change)),
    ],
  );
}

for (const size of [1_000, 10_000]) {
  await validate(size);
  const rows = `${size.toLocaleString("en-US")} rows`;

  describe(`Build the list and read it (${rows})`, () => {
    for (const [name, build] of IMPLEMENTATIONS) {
      const tasks = makeTasks(size);
      bench(name, () => {
        const harness = build(tasks.map((task) => ({ ...task })));
        harness.read();
        harness.dispose();
      });
    }
  });

  for (const [title, edit] of scenarios(size)) {
    describe(`${title} (${rows})`, () => {
      for (const [name, build] of IMPLEMENTATIONS) {
        benchChanges(
          name,
          () => build(makeTasks(size)),
          (harness, i) => harness.edit(edit(i)),
        );
      }
    });
  }

  for (const [title, change] of membershipScenarios(size)) {
    describe(`${title} (${rows})`, () => {
      for (const [name, build] of IMPLEMENTATIONS) {
        benchChanges(
          name,
          () => build(makeTasks(size)),
          (harness, i) => harness.change(change(i)),
        );
      }
    });
  }
}

// --- Joins: tasks joined to their owners (see `joinScenarios`) ---

interface JoinHarness {
  read(): number[];
  change(change: JoinChange): void;
  dispose(): void;
}

type BuildJoin = (tasks: Owned[], users: User[]) => JoinHarness;

function supergrainJoin(makeList: JoinedList): BuildJoin {
  return (tasks, users) => {
    const { store, change } = supergrainJoinStore(tasks, users);
    const list = makeList(store);
    return { read: () => list().map(({ task }) => task.id), change, dispose: () => {} };
  };
}

const tanstackJoined: BuildJoin = (tasks, users) => {
  const setup = tanstackJoin(tasks, users);
  const query = watch(
    createLiveQueryCollection({
      startSync: true,
      query: (q) => tanstackJoinedTopTen(q, setup.tasks, setup.users),
    }),
  );
  return {
    read: () => Array.from(query.values(), (row: { task: Owned }) => row.task.id),
    change: setup.change,
    dispose: () => {
      query.stop();
      setup.dispose();
    },
  };
};

const JOIN_IMPLEMENTATIONS: ReadonlyArray<[string, BuildJoin]> = [
  ["supergrain computedList", supergrainJoin(supergrainJoined)],
  ["supergrain stableComputed + Map", supergrainJoin(stableComputedJoined)],
  ["TanStack DB join (sync write)", tanstackJoined],
];

function validateJoin(size: number): Promise<void> {
  return expectAgreement(
    `${size} rows`,
    JOIN_IMPLEMENTATIONS.map(
      ([name, build]) => [name, () => build(makeOwnedTasks(size), makeUsers())] as const,
    ),
    (harness) => harness.read(),
    joinValidationChanges(size).map((change) => (harness: JoinHarness) => harness.change(change)),
  );
}

for (const size of [1_000, 10_000]) {
  await validateJoin(size);
  const rows = `${size.toLocaleString("en-US")} tasks, 100 users`;

  describe(`Join: build the list and read it (${rows})`, () => {
    for (const [name, build] of JOIN_IMPLEMENTATIONS) {
      const tasks = makeOwnedTasks(size);
      bench(name, () => {
        const harness = build(
          tasks.map((task) => ({ ...task })),
          makeUsers(),
        );
        harness.read();
        harness.dispose();
      });
    }
  });

  for (const [title, change] of joinScenarios(size)) {
    describe(`Join: ${title} (${rows})`, () => {
      for (const [name, build] of JOIN_IMPLEMENTATIONS) {
        benchChanges(
          name,
          () => build(makeOwnedTasks(size), makeUsers()),
          (harness, i) => harness.change(change(i)),
        );
      }
    });
  }
}

// --- One-to-many: each active user with their open tasks ---

interface OneToManyHarness {
  /** Each user's id and open task ids: what validation compares. */
  readAll(): Array<[number, number[]]>;
  /** Each user's id and open task count: what each benchmark reads. */
  read(): number[];
  change(change: JoinChange): void;
  dispose(): void;
}

type BuildOneToMany = (tasks: Owned[], users: User[]) => OneToManyHarness;

type Grouped = Iterable<{ user: { id: number }; tasks: Iterable<{ id: number }> }>;
const readAll = (rows: Grouped): Array<[number, number[]]> =>
  Array.from(rows, ({ user, tasks }) => [user.id, ids(tasks)]);
const readCounts = (rows: Iterable<{ tasks: { length: number } }>): number[] =>
  Array.from(rows, ({ tasks }) => tasks.length);

function supergrainOneToMany(makeList: OpenTasksByUser): BuildOneToMany {
  return (tasks, users) => {
    const { store, change } = supergrainJoinStore(tasks, users);
    const list = makeList(store);
    return {
      readAll: () => readAll(list()),
      read: () => readCounts(list()),
      change,
      dispose: () => {},
    };
  };
}

const tanstackOneToMany: BuildOneToMany = (tasks, users) => {
  const setup = tanstackJoin(tasks, users);
  const query = watch(
    createLiveQueryCollection({
      startSync: true,
      query: (q) => tanstackOpenTasksByUser(q, setup.tasks, setup.users),
    }),
  );
  const rows = () => query.values() as Iterable<{ user: User; tasks: Owned[] }>;
  return {
    readAll: () => readAll(rows()),
    read: () => readCounts(rows()),
    change: setup.change,
    dispose: () => {
      query.stop();
      setup.dispose();
    },
  };
};

const ONE_TO_MANY_IMPLEMENTATIONS: ReadonlyArray<[string, BuildOneToMany]> = [
  ["supergrain getAll", supergrainOneToMany(supergrainOpenTasksByUser)],
  ["supergrain getAll from a list", supergrainOneToMany(supergrainOpenTasksByUserFromList)],
  ["supergrain stableComputed + Map", supergrainOneToMany(stableComputedOpenTasksByUser)],
  ["TanStack DB toArray (sync write)", tanstackOneToMany],
];

function validateOneToMany(size: number): Promise<void> {
  const changes = [
    ...oneToManyScenarios(size).flatMap(([, change]) => [change(0), change(1)]),
    ...joinValidationChanges(size),
  ];
  return expectAgreement(
    `${size} tasks`,
    ONE_TO_MANY_IMPLEMENTATIONS.map(
      ([name, build]) => [name, () => build(makeOwnedTasks(size), makeUsers())] as const,
    ),
    (harness) => harness.readAll(),
    changes.map((change) => (harness: OneToManyHarness) => harness.change(change)),
  );
}

for (const size of [1_000, 10_000]) {
  await validateOneToMany(size);
  const rows = `${size.toLocaleString("en-US")} tasks, 100 users`;

  describe(`One-to-many: build the list and read it (${rows})`, () => {
    for (const [name, build] of ONE_TO_MANY_IMPLEMENTATIONS) {
      const tasks = makeOwnedTasks(size);
      bench(name, async () => {
        const harness = build(
          tasks.map((task) => ({ ...task })),
          makeUsers(),
        );
        await settled();
        harness.read();
        harness.dispose();
      });
    }
  });

  for (const [title, change] of oneToManyScenarios(size)) {
    describe(`One-to-many: ${title} (${rows})`, () => {
      for (const [name, build] of ONE_TO_MANY_IMPLEMENTATIONS) {
        benchChanges(
          name,
          () => build(makeOwnedTasks(size), makeUsers()),
          (harness, i) => harness.change(change(i)),
        );
      }
    });
  }
}

// --- Grouping: open tasks counted per owner ---

interface GroupHarness {
  read(): Array<[number, number]>;
  change(change: JoinChange): void;
  dispose(): void;
}

type BuildGroup = (tasks: Owned[]) => GroupHarness;

const readGroups = (rows: Iterable<{ ownerId: number; count: number }>): Array<[number, number]> =>
  Array.from(rows, ({ ownerId, count }) => [ownerId, count]);

function supergrainGroups(makeList: CountsByOwner): BuildGroup {
  return (tasks) => {
    const { store, change } = supergrainJoinStore(tasks, makeUsers());
    const list = makeList(store);
    return { read: () => readGroups(list()), change, dispose: () => {} };
  };
}

const tanstackGroups: BuildGroup = (tasks) => {
  const setup = tanstackJoin(tasks, makeUsers());
  const query = watch(
    createLiveQueryCollection({
      startSync: true,
      query: (q) => tanstackCountsByOwner(q, setup.tasks),
    }),
  );
  return {
    read: () => readGroups(query.values() as Iterable<{ ownerId: number; count: number }>),
    change: setup.change,
    dispose: () => {
      query.stop();
      setup.dispose();
    },
  };
};

const GROUP_IMPLEMENTATIONS: ReadonlyArray<[string, BuildGroup]> = [
  ["supergrain groupBy", supergrainGroups(supergrainCountsByOwner)],
  ["supergrain stableComputed + Map", supergrainGroups(stableComputedCountsByOwner)],
  ["TanStack DB groupBy (sync write)", tanstackGroups],
];

function validateGroups(size: number): Promise<void> {
  const changes = groupScenarios(size).flatMap(([, change]) => [change(0), change(1)]);
  return expectAgreement(
    `${size} tasks`,
    GROUP_IMPLEMENTATIONS.map(
      ([name, build]) => [name, () => build(makeOwnedTasks(size))] as const,
    ),
    (harness) => harness.read(),
    changes.map((change) => (harness: GroupHarness) => harness.change(change)),
  );
}

for (const size of [1_000, 10_000]) {
  await validateGroups(size);
  const rows = `${size.toLocaleString("en-US")} tasks, 110 owners`;

  describe(`Group: build the list and read it (${rows})`, () => {
    for (const [name, build] of GROUP_IMPLEMENTATIONS) {
      const tasks = makeOwnedTasks(size);
      bench(name, async () => {
        const harness = build(tasks.map((task) => ({ ...task })));
        await settled();
        harness.read();
        harness.dispose();
      });
    }
  });

  for (const [title, change] of groupScenarios(size)) {
    describe(`Group: ${title} (${rows})`, () => {
      for (const [name, build] of GROUP_IMPLEMENTATIONS) {
        benchChanges(
          name,
          () => build(makeOwnedTasks(size)),
          (harness, i) => harness.change(change(i)),
        );
      }
    });
  }
}
