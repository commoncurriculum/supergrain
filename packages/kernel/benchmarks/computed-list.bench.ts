import { createLiveQueryCollection } from "@tanstack/db";
import { bench, describe } from "vitest";

import {
  computedListTopTen,
  makeTasks,
  scenarios,
  stableComputedTopTen,
  supergrainStore,
  tanstackOptimisticUpdate,
  tanstackSyncWrite,
  tanstackTopTen,
  validationEdits,
  type Edit,
  type SupergrainQuery,
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

/** What every implementation can do: edit rows, and read the top 10 ids. */
interface Harness {
  read(): number[];
  edit(changes: Edit): void;
  dispose(): void;
}

type Build = (tasks: Task[]) => Harness;

const ids = (rows: Iterable<{ id: number }>) => Array.from(rows, (row) => row.id);

function supergrain(makeQuery: SupergrainQuery): Build {
  return (tasks) => {
    const { store, edit } = supergrainStore(tasks);
    const query = makeQuery(store);
    return { read: () => ids(query()), edit, dispose: () => {} };
  };
}

function tanstack(setup: (tasks: Task[]) => TanstackTasks): Build {
  return (tasks) => {
    const { collection, edit, dispose } = setup(tasks);
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) => tanstackTopTen(q, collection),
    });
    return {
      read: () => ids(query.values()),
      edit,
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

  describe(`Build the query and read it (${rows})`, () => {
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
}
