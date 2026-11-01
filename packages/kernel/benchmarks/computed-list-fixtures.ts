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

/** Add a task at a position in the source, or remove one by id. */
export type Membership =
  | { readonly insert: Task; readonly at: number }
  | { readonly remove: number };

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

/**
 * The benchmarked adds and removes. Even iterations add a task, odd ones
 * remove it again, so the source is back where it started after each pair.
 */
export function membershipScenarios(
  size: number,
): ReadonlyArray<[title: string, change: (i: number) => Membership]> {
  const added = (id: number): Task => ({ id, completed: false, priority: 3, title: `t${id}` });
  return [
    [
      "Add or remove a task at the end",
      (i) => (i % 2 === 0 ? { insert: added(size), at: size } : { remove: size }),
    ],
    [
      "Add or remove a task in the middle",
      (i) => (i % 2 === 0 ? { insert: added(size + 1), at: size / 2 } : { remove: size + 1 }),
    ],
  ];
}

// --- supergrain ---

export type SupergrainList = (store: { tasks: Task[] }) => () => ReadonlyArray<Task>;

export const computedListTopTen: SupergrainList = (store) =>
  computedList({
    from: () => store.tasks,
    where: (task) => !task.completed,
    orderBy: (task) => [task.priority, task.id],
    limit: 10,
  });

export const stableComputedTopTen: SupergrainList = (store) =>
  stableComputed(() =>
    store.tasks
      .filter((task) => !task.completed)
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .slice(0, 10),
  );

export function supergrainStore(tasks: Task[]): {
  store: { tasks: Task[] };
  edit: (changes: Edit) => void;
  change: (change: Membership) => void;
} {
  const store = createReactive({ tasks });
  return {
    store,
    // Tasks sit at the index of their id, except while an added task is in.
    edit: (changes: Edit) =>
      batch(() => {
        for (const { id, patch } of changes) Object.assign(store.tasks[id]!, patch);
      }),
    change: (change) => {
      if ("insert" in change) store.tasks.splice(change.at, 0, change.insert);
      else
        store.tasks.splice(
          store.tasks.findIndex((task) => task.id === change.remove),
          1,
        );
    },
  };
}

// --- TanStack DB ---

/** A TanStack DB collection of tasks, and how this setup writes to it. */
export interface TanstackTasks {
  collection: Collection<Task, number>;
  edit: (changes: Edit) => void;
  change: (change: Membership) => void;
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
    write: (message: { type: "insert" | "update" | "delete"; value: Task }) => void;
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
    change: (change) => {
      writer.begin();
      if ("insert" in change) {
        rows.set(change.insert.id, change.insert);
        writer.write({ type: "insert", value: change.insert });
      } else {
        writer.write({ type: "delete", value: rows.get(change.remove)! });
        rows.delete(change.remove);
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
    change: (change) => {
      if ("insert" in change) collection.insert({ ...change.insert });
      else collection.delete(change.remove);
    },
    dispose: () => void collection.cleanup(),
  };
}
