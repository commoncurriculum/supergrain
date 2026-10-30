import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
  type Collection,
} from "@tanstack/db";
import { bench, describe } from "vitest";

import { batch, createReactive, liveQuery, stableComputed } from "../src";

/**
 * `liveQuery` vs `stableComputed` vs TanStack DB 1.0 RC1 live queries.
 *
 * The query everywhere: "tasks not completed, by priority then id, top 10".
 * Each benchmark is one change followed by one read of the result, the way a
 * UI would see it. Every change is undone by the next iteration (a toggle), so
 * the work per iteration stays the same.
 *
 * TanStack DB runs two ways:
 * - "sync write": rows written through a sync adapter (begin/write/commit),
 *   which is how server data reaches a collection. No optimistic layer.
 * - "optimistic update": `collection.update(key, draft => …)` on a local-only
 *   collection, which is how a user edit reaches it. This includes the
 *   transaction machinery.
 * Both get the B-tree indexes TanStack DB asks for (on `priority` and
 * `completed`).
 *
 * Before timing, every implementation runs the same edits and must return the
 * same rows, so the numbers compare equal work.
 */

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

/** What every implementation can do: edit rows, and read the top 10 ids. */
interface Harness {
  read(): number[];
  edit(changes: ReadonlyArray<{ id: number; patch: Partial<Task> }>): void;
  dispose(): void;
}

type Build = (tasks: Task[]) => Harness;

const keyOf = (task: Task) => [task.priority, task.id];
const ids = (rows: ReadonlyArray<{ id: number }>) => rows.map((row) => row.id);

function supergrain(makeQuery: (store: { tasks: Task[] }) => () => ReadonlyArray<Task>): Build {
  return (tasks) => {
    const store = createReactive({ tasks });
    const query = makeQuery(store);
    return {
      read: () => ids(query()),
      edit: (changes) =>
        batch(() => {
          for (const { id, patch } of changes) Object.assign(store.tasks[id]!, patch);
        }),
      dispose: () => {},
    };
  };
}

const supergrainLiveQuery = supergrain((store) =>
  liveQuery({
    from: () => store.tasks,
    where: (task) => !task.completed,
    orderBy: keyOf,
    limit: 10,
  }),
);

const supergrainStableComputed = supergrain((store) =>
  stableComputed(() =>
    store.tasks
      .filter((task) => !task.completed)
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .slice(0, 10),
  ),
);

function topTen(collection: Collection<Task, number>) {
  const query = createLiveQueryCollection({
    startSync: true,
    query: (q) =>
      q
        .from({ task: collection })
        .where(({ task }) => eq(task.completed, false))
        .orderBy(({ task }) => task.priority, "asc")
        .orderBy(({ task }) => task.id, "asc")
        .limit(10),
  });
  return query;
}

function indexed(collection: Collection<Task, number>) {
  collection.createIndex((row) => row.priority, { indexType: BTreeIndex });
  collection.createIndex((row) => row.completed, { indexType: BTreeIndex });
  return collection;
}

const tanstackSyncWrite: Build = (tasks) => {
  const rows = new Map(tasks.map((task) => [task.id, { ...task }]));
  let writer!: {
    begin: () => void;
    write: (message: { type: "update"; value: Task }) => void;
    commit: () => void;
  };
  const collection = indexed(
    createCollection<Task, number>({
      id: `tasks-sync-${Math.random()}`,
      getKey: (task) => task.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          writer = { begin, write, commit };
          begin();
          for (const task of rows.values()) write({ type: "insert", value: task });
          commit();
          markReady();
        },
      },
    }),
  );
  const query = topTen(collection);
  return {
    read: () => ids([...query.values()]),
    edit: (changes) => {
      writer.begin();
      for (const { id, patch } of changes) {
        const next = { ...rows.get(id)!, ...patch };
        rows.set(id, next);
        writer.write({ type: "update", value: next });
      }
      writer.commit();
    },
    dispose: () => {
      void query.cleanup();
      void collection.cleanup();
    },
  };
};

const tanstackOptimisticUpdate: Build = (tasks) => {
  const collection = indexed(
    createCollection(
      localOnlyCollectionOptions<Task, number>({
        id: `tasks-local-${Math.random()}`,
        getKey: (task) => task.id,
        initialData: tasks,
      }),
    ),
  );
  const query = topTen(collection);
  return {
    read: () => ids([...query.values()]),
    edit: (changes) => {
      const patches = new Map(changes.map(({ id, patch }) => [id, patch]));
      collection.update([...patches.keys()], (drafts) => {
        for (const draft of drafts) Object.assign(draft, patches.get(draft.id));
      });
    },
    dispose: () => {
      void query.cleanup();
      void collection.cleanup();
    },
  };
};

const IMPLEMENTATIONS: ReadonlyArray<[string, Build]> = [
  ["supergrain liveQuery", supergrainLiveQuery],
  ["supergrain stableComputed", supergrainStableComputed],
  ["TanStack DB (sync write)", tanstackSyncWrite],
  ["TanStack DB (optimistic update)", tanstackOptimisticUpdate],
];

/** Run the same edits on every implementation; throw if any result differs. */
function validate(size: number): void {
  const edits: Array<ReadonlyArray<{ id: number; patch: Partial<Task> }>> = [
    [{ id: 5, patch: { title: "renamed" } }],
    [{ id: 7, patch: { completed: true } }],
    [{ id: size / 2 + 1, patch: { completed: true } }],
    [{ id: 21, patch: { priority: 6 } }],
    [{ id: 0, patch: { completed: false } }],
    Array.from({ length: 50 }, (_, i) => ({ id: i * 3, patch: { completed: i % 2 === 0 } })),
  ];
  const results = IMPLEMENTATIONS.map(([name, build]) => {
    const harness = build(makeTasks(size));
    const seen = [harness.read()];
    for (const edit of edits) {
      harness.edit(edit);
      seen.push(harness.read());
    }
    harness.dispose();
    return [name, JSON.stringify(seen)] as const;
  });
  for (const [name, seen] of results) {
    if (seen !== results[0]![1]) {
      throw new Error(`live-query bench: ${name} disagrees with ${results[0]![0]} at ${size} rows`);
    }
  }
}

/** One benchmark per implementation, each with its own fresh data. */
function compare(title: string, size: number, step: (harness: Harness, i: number) => void) {
  describe(`${title} (${size.toLocaleString("en-US")} rows)`, () => {
    for (const [name, build] of IMPLEMENTATIONS) {
      const harness = build(makeTasks(size));
      harness.read();
      let i = 0;
      bench(name, () => {
        step(harness, i++);
        harness.read();
      });
    }
  });
}

for (const size of [1_000, 10_000]) {
  validate(size);

  describe(`Build the query and read it (${size.toLocaleString("en-US")} rows)`, () => {
    for (const [name, build] of IMPLEMENTATIONS) {
      const tasks = makeTasks(size);
      bench(name, () => {
        const harness = build(tasks.map((task) => ({ ...task })));
        harness.read();
        harness.dispose();
      });
    }
  });

  compare("A. Rename a task the query never reads", size, (h, i) =>
    h.edit([{ id: 5, patch: { title: `t${i}` } }]),
  );
  compare("C. Complete or reopen a task outside the top 10", size, (h, i) =>
    h.edit([{ id: size / 2 + 1, patch: { completed: i % 2 === 0 } }]),
  );
  compare("D. Complete or reopen a task inside the top 10", size, (h, i) =>
    h.edit([{ id: 7, patch: { completed: i % 2 === 0 } }]),
  );
  compare("Move a listed task (priority 0 ↔ 6)", size, (h, i) =>
    h.edit([{ id: 21, patch: { priority: i % 2 === 0 ? 6 : 0 } }]),
  );
  compare("Change 100 tasks at once", size, (h, i) =>
    h.edit(
      Array.from({ length: 100 }, (_, n) => ({
        id: (n * 97) % size,
        patch: { completed: (i + n) % 2 === 0 },
      })),
    ),
  );
}
