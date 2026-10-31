import {
  BTreeIndex,
  createCollection,
  eq,
  localOnlyCollectionOptions,
  type Collection,
  type InitialQueryBuilder,
  type QueryBuilder,
} from "@tanstack/db";

import { batch, createReactive, computedList, stableComputed } from "../src";

/**
 * Shared setup for `computed-list.bench.ts` (plain JS) and
 * `react/computed-list.bench.tsx` (the same comparison rendered by React).
 *
 * The query everywhere: "tasks not completed, by priority then id, top 10".
 */

export interface Task {
  id: number;
  completed: boolean;
  priority: number;
  title: string;
}

export type Edit = ReadonlyArray<{ id: number; patch: Partial<Task> }>;

export function makeTasks(count: number): Task[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    completed: i % 2 === 0,
    priority: i % 7,
    title: `t${i}`,
  }));
}

/** Edits that touch every case; every implementation must agree after each. */
export function validationEdits(size: number): Edit[] {
  return [
    [{ id: 5, patch: { title: "renamed" } }],
    [{ id: 35, patch: { title: "renamed too" } }],
    [{ id: 7, patch: { completed: true } }],
    [{ id: size / 2 + 1, patch: { completed: true } }],
    [{ id: 21, patch: { priority: 6 } }],
    [{ id: 0, patch: { completed: false } }],
    Array.from({ length: 50 }, (_, i) => ({ id: i * 3, patch: { completed: i % 2 === 0 } })),
  ];
}

/** The benchmarked changes. Each is undone by the next iteration, so work stays level. */
export function scenarios(size: number): ReadonlyArray<[title: string, edit: (i: number) => Edit]> {
  return [
    ["A. Rename a task the query never shows", (i) => [{ id: 5, patch: { title: `t${i}` } }]],
    ["Rename a task in the top 10", (i) => [{ id: 35, patch: { title: `t${i}` } }]],
    [
      "C. Complete or reopen a task outside the top 10",
      (i) => [{ id: size / 2 + 1, patch: { completed: i % 2 === 0 } }],
    ],
    [
      "D. Complete or reopen a task inside the top 10",
      (i) => [{ id: 7, patch: { completed: i % 2 === 0 } }],
    ],
    [
      "Move a listed task (priority 0 ↔ 6)",
      (i) => [{ id: 21, patch: { priority: i % 2 === 0 ? 6 : 0 } }],
    ],
    [
      "Change 100 tasks at once",
      (i) =>
        Array.from({ length: 100 }, (_, n) => ({
          id: (n * 97) % size,
          patch: { completed: (i + n) % 2 === 0 },
        })),
    ],
  ];
}

// --- supergrain ---

export type SupergrainQuery = (store: { tasks: Task[] }) => () => ReadonlyArray<Task>;

export const computedListTopTen: SupergrainQuery = (store) =>
  computedList({
    from: () => store.tasks,
    where: (task) => !task.completed,
    orderBy: (task) => [task.priority, task.id],
    limit: 10,
  });

export const stableComputedTopTen: SupergrainQuery = (store) =>
  stableComputed(() =>
    store.tasks
      .filter((task) => !task.completed)
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .slice(0, 10),
  );

export function supergrainStore(tasks: Task[]): {
  store: { tasks: Task[] };
  edit: (changes: Edit) => void;
} {
  const store = createReactive({ tasks });
  return {
    store,
    edit: (changes: Edit) =>
      batch(() => {
        for (const { id, patch } of changes) Object.assign(store.tasks[id]!, patch);
      }),
  };
}

// --- TanStack DB ---

/** A TanStack DB collection of tasks, and how this setup writes to it. */
export interface TanstackTasks {
  collection: Collection<Task, number>;
  edit: (changes: Edit) => void;
  dispose: () => void;
}

/**
 * The top-10 query in TanStack DB's builder, for `createLiveQueryCollection`
 * or `useLiveQuery`. (Typed loosely: its inferred type can't be named in a
 * declaration file.)
 */
export const tanstackTopTen = (
  q: InitialQueryBuilder,
  collection: Collection<Task, number>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
): QueryBuilder<any> =>
  q
    .from({ task: collection })
    .where(({ task }) => eq(task.completed, false))
    .orderBy(({ task }) => task.priority, "asc")
    .orderBy(({ task }) => task.id, "asc")
    .limit(10);

function indexed(collection: Collection<Task, number>) {
  collection.createIndex((row) => row.priority, { indexType: BTreeIndex });
  collection.createIndex((row) => row.completed, { indexType: BTreeIndex });
  return collection;
}

/**
 * Rows written through a sync adapter (begin/write/commit), which is how
 * server data reaches a collection. No optimistic layer.
 */
export function tanstackSyncWrite(tasks: Task[]): TanstackTasks {
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
  return {
    collection,
    edit: (changes) => {
      writer.begin();
      for (const { id, patch } of changes) {
        const next = { ...rows.get(id)!, ...patch };
        rows.set(id, next);
        writer.write({ type: "update", value: next });
      }
      writer.commit();
    },
    dispose: () => void collection.cleanup(),
  };
}

/**
 * `collection.update(keys, drafts => …)` on a local-only collection, which is
 * how a user edit reaches it. This includes the transaction machinery.
 */
export function tanstackOptimisticUpdate(tasks: Task[]): TanstackTasks {
  const collection = indexed(
    createCollection(
      localOnlyCollectionOptions<Task, number>({
        id: `tasks-local-${Math.random()}`,
        getKey: (task) => task.id,
        initialData: tasks,
      }),
    ),
  );
  return {
    collection,
    edit: (changes) => {
      const patches = new Map(changes.map(({ id, patch }) => [id, patch]));
      collection.update([...patches.keys()], (drafts) => {
        for (const draft of drafts) Object.assign(draft, patches.get(draft.id));
      });
    },
    dispose: () => void collection.cleanup(),
  };
}
