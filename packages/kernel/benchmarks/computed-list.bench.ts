import { createLiveQueryCollection } from "@tanstack/db";
import { bench, describe } from "vitest";

import {
  computedListTopTen,
  joinScenarios,
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

function tanstack(setup: (tasks: Task[]) => TanstackTasks): Build {
  return (tasks) => {
    const { collection, edit, change, dispose } = setup(tasks);
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) => tanstackTopTen(q, collection),
    });
    return {
      read: () => ids(query.values()),
      edit,
      change,
      dispose: () => {
        void query.cleanup();
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
function validate(size: number): void {
  const results = IMPLEMENTATIONS.map(([name, build]) => {
    const harness = build(makeTasks(size));
    const seen = [harness.read()];
    for (const edit of validationEdits(size)) {
      harness.edit(edit);
      seen.push(harness.read());
    }
    for (const [, change] of membershipScenarios(size)) {
      for (let i = 0; i < 2; i++) {
        harness.change(change(i));
        seen.push(harness.read());
      }
    }
    harness.dispose();
    return [name, JSON.stringify(seen)] as const;
  });
  for (const [name, seen] of results) {
    if (seen !== results[0]![1]) {
      throw new Error(
        `computed-list bench: ${name} disagrees with ${results[0]![0]} at ${size} rows`,
      );
    }
  }
}

for (const size of [1_000, 10_000]) {
  validate(size);
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
        const harness = build(makeTasks(size));
        harness.read();
        let i = 0;
        bench(name, () => {
          harness.edit(edit(i++));
          harness.read();
        });
      }
    });
  }

  for (const [title, change] of membershipScenarios(size)) {
    describe(`${title} (${rows})`, () => {
      for (const [name, build] of IMPLEMENTATIONS) {
        const harness = build(makeTasks(size));
        harness.read();
        let i = 0;
        bench(name, () => {
          harness.change(change(i++));
          harness.read();
        });
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
  const query = createLiveQueryCollection({
    startSync: true,
    query: (q) => tanstackJoinedTopTen(q, setup.tasks, setup.users),
  });
  return {
    read: () => Array.from(query.values(), (row: { task: Owned }) => row.task.id),
    change: setup.change,
    dispose: () => {
      void query.cleanup();
      setup.dispose();
    },
  };
};

const JOIN_IMPLEMENTATIONS: ReadonlyArray<[string, BuildJoin]> = [
  ["supergrain computedList", supergrainJoin(supergrainJoined)],
  ["supergrain stableComputed + Map", supergrainJoin(stableComputedJoined)],
  ["TanStack DB join (sync write)", tanstackJoined],
];

function validateJoin(size: number): void {
  const results = JOIN_IMPLEMENTATIONS.map(([name, build]) => {
    const harness = build(makeOwnedTasks(size), makeUsers());
    const seen = [harness.read()];
    for (const change of joinValidationChanges(size)) {
      harness.change(change);
      seen.push(harness.read());
    }
    harness.dispose();
    return [name, JSON.stringify(seen)] as const;
  });
  for (const [name, seen] of results) {
    if (seen !== results[0]![1]) {
      throw new Error(
        `computed-list bench: ${name} disagrees with ${results[0]![0]} at ${size} rows`,
      );
    }
  }
}

for (const size of [1_000, 10_000]) {
  validateJoin(size);
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
        const harness = build(makeOwnedTasks(size), makeUsers());
        harness.read();
        let i = 0;
        bench(name, () => {
          harness.change(change(i++));
          harness.read();
        });
      }
    });
  }
}
