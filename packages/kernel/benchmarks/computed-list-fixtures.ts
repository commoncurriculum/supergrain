import {
  and,
  BTreeIndex,
  count,
  createCollection,
  eq,
  localOnlyCollectionOptions,
  type Collection,
  type InitialQueryBuilder,
  type QueryBuilder,
  toArray,
} from "@tanstack/db";

import { batch, createReactive, computedList, stableComputed, unwrap } from "../src";

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
  computedList(() => store.tasks)
    .filter((task) => !task.completed)
    .orderBy((task) => task.priority)
    .orderBy((task) => task.id)
    .limit(10);

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
          unwrap(store.tasks).findIndex((task) => task.id === change.remove),
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

// --- Joins: tasks joined to their owners ---

/**
 * The join query everywhere: "tasks not completed whose owner is active, by
 * priority then id, top 10". Tasks are owned by users 0–109, but only users
 * 0–99 exist at the start, so the inner join drops some tasks until their
 * owner is added.
 */
export interface Owned extends Task {
  ownerId: number;
}

export interface User {
  id: number;
  active: boolean;
  name: string;
}

export const USERS = 100;

export function makeOwnedTasks(count: number): Owned[] {
  return makeTasks(count).map((task) => ({ ...task, ownerId: (task.id * 7) % (USERS + 10) }));
}

export function makeUsers(): User[] {
  return Array.from({ length: USERS }, (_, id) => ({ id, active: id % 5 !== 0, name: `u${id}` }));
}

/** A change to either side of the join. */
export type JoinChange =
  | { readonly task: number; readonly patch: Partial<Owned> }
  | { readonly user: number; readonly patch: Partial<User> }
  | { readonly addTask: Owned }
  | { readonly removeTask: number }
  | { readonly addUser: User }
  | { readonly removeUser: number };

/** The benchmarked join changes. Each is undone by the next iteration. */
export function joinScenarios(
  size: number,
): ReadonlyArray<[title: string, change: (i: number) => JoinChange]> {
  const added: Owned = { id: size, ownerId: 1, completed: false, priority: 3, title: "new" };
  return [
    ["Rename a user (nothing reads the name)", (i) => ({ user: 3, patch: { name: `n${i}` } })],
    [
      "Complete or reopen a task outside the top 10",
      (i) => ({ task: size / 2 + 1, patch: { completed: i % 2 === 0 } }),
    ],
    ["Deactivate or reactivate a user", (i) => ({ user: 1, patch: { active: i % 2 !== 0 } })],
    [
      "Add or remove a task",
      (i) => (i % 2 === 0 ? { addTask: { ...added } } : { removeTask: size }),
    ],
    [
      "Add or remove a user that owns tasks",
      (i) =>
        i % 2 === 0
          ? { addUser: { id: USERS + 3, active: true, name: "new" } }
          : { removeUser: USERS + 3 },
    ],
  ];
}

/** The join's changes, plus moving a task to another owner and back. */
export function oneToManyScenarios(
  size: number,
): ReadonlyArray<[title: string, change: (i: number) => JoinChange]> {
  const moved = size / 2 + 1;
  const owner = (moved * 7) % (USERS + 10);
  return [
    ...joinScenarios(size),
    [
      "Move an open task to another user",
      (i) => ({ task: moved, patch: { ownerId: i % 2 === 0 ? (owner + 1) % USERS : owner } }),
    ],
  ];
}

/** Changes that touch every case; every implementation must agree after each. */
export function joinValidationChanges(size: number): JoinChange[] {
  return [
    ...joinScenarios(size).flatMap(([, change]) => [change(0), change(1)]),
    { user: 2, patch: { active: false } },
    { task: 9, patch: { ownerId: 2 } },
    { addUser: { id: USERS + 5, active: true, name: "late" } },
    { task: 0, patch: { completed: false } },
  ];
}

export type JoinedList = (store: { tasks: Owned[]; users: User[] }) => () => ReadonlyArray<{
  task: Owned;
}>;

export const supergrainJoined: JoinedList = (store) =>
  computedList(() => store.tasks, { users: () => store.users })
    .filter((task) => !task.completed)
    .map((task, { users }) => ({ task, owner: users.get(task.ownerId) }))
    .filter(({ owner }) => owner?.active === true)
    .orderBy(({ task }) => task.priority)
    .orderBy(({ task }) => task.id)
    .limit(10);

export const stableComputedJoined: JoinedList = (store) =>
  stableComputed(() => {
    const usersById = new Map(store.users.map((user) => [user.id, user]));
    return store.tasks
      .filter((task) => !task.completed && usersById.get(task.ownerId)?.active === true)
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .slice(0, 10)
      .map((task) => ({ task }));
  });

export function supergrainJoinStore(
  tasks: Owned[],
  users: User[],
): { store: { tasks: Owned[]; users: User[] }; change: (change: JoinChange) => void } {
  const store: { tasks: Owned[]; users: User[] } = createReactive({ tasks, users });
  // Search the raw array: reading 10k rows through the store would cost more
  // than the change being measured.
  const indexOf = <T extends { id: number }>(list: T[], id: number) =>
    unwrap(list).findIndex((row) => row.id === id);
  return {
    store,
    change: (change: JoinChange) =>
      batch(() => {
        if ("task" in change)
          Object.assign(store.tasks[indexOf(store.tasks, change.task)]!, change.patch);
        else if ("user" in change)
          Object.assign(store.users[indexOf(store.users, change.user)]!, change.patch);
        else if ("addTask" in change) store.tasks.push(change.addTask);
        else if ("removeTask" in change)
          store.tasks.splice(indexOf(store.tasks, change.removeTask), 1);
        else if ("addUser" in change) store.users.push(change.addUser);
        else store.users.splice(indexOf(store.users, change.removeUser), 1);
      }),
  };
}

/** A collection written through a sync adapter, as server data would be. */
function syncCollection<T extends { id: number }>(name: string, initial: T[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let writer!: {
    begin: () => void;
    write: (message: { type: "insert" | "update" | "delete"; value: T }) => void;
    commit: () => void;
  };
  const collection = createCollection<T, number>({
    id: `${name}-${Math.random()}`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        writer = { begin, write, commit };
        begin();
        for (const row of rows.values()) write({ type: "insert", value: row });
        commit();
        markReady();
      },
    },
  });
  const write = (type: "insert" | "update" | "delete", value: T) => {
    writer.begin();
    writer.write({ type, value });
    writer.commit();
  };
  return {
    collection,
    update: (id: number, patch: Partial<T>) => {
      const next = { ...rows.get(id)!, ...patch };
      rows.set(id, next);
      write("update", next);
    },
    insert: (row: T) => {
      rows.set(row.id, { ...row });
      write("insert", { ...row });
    },
    remove: (id: number) => {
      write("delete", rows.get(id)!);
      rows.delete(id);
    },
  };
}

/** TanStack DB's join over two sync-written collections, with B-tree indexes. */
export function tanstackJoin(tasks: Owned[], users: User[]) {
  const taskRows = syncCollection("tasks", tasks);
  const userRows = syncCollection("users", users);
  taskRows.collection.createIndex((row) => row.priority, { indexType: BTreeIndex });
  taskRows.collection.createIndex((row) => row.completed, { indexType: BTreeIndex });
  taskRows.collection.createIndex((row) => row.ownerId, { indexType: BTreeIndex });
  userRows.collection.createIndex((row) => row.active, { indexType: BTreeIndex });
  return {
    tasks: taskRows.collection,
    users: userRows.collection,
    change: (change: JoinChange) => {
      if ("task" in change) taskRows.update(change.task, change.patch);
      else if ("user" in change) userRows.update(change.user, change.patch);
      else if ("addTask" in change) taskRows.insert(change.addTask);
      else if ("removeTask" in change) taskRows.remove(change.removeTask);
      else if ("addUser" in change) userRows.insert(change.addUser);
      else userRows.remove(change.removeUser);
    },
    dispose: () => {
      void taskRows.collection.cleanup();
      void userRows.collection.cleanup();
    },
  };
}

/** The join query in TanStack DB's builder. (Typed loosely, as above.) */
export const tanstackJoinedTopTen = (
  q: InitialQueryBuilder,
  tasks: Collection<Owned, number>,
  users: Collection<User, number>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see tanstackTopTen
): QueryBuilder<any> =>
  q
    .from({ task: tasks })
    .join({ owner: users }, ({ task, owner }) => eq(task.ownerId, owner.id), "inner")
    .where(({ task, owner }) => and(eq(task.completed, false), eq(owner.active, true)))
    .orderBy(({ task }) => task.priority, "asc")
    .orderBy(({ task }) => task.id, "asc")
    .limit(10);

// --- One-to-many: each active user with their open tasks ---

/**
 * The one-to-many query everywhere: "active users by id, each with their
 * open tasks by id". Same tasks, users and changes as the join.
 */
export type OpenTasksByUser = (store: {
  tasks: Owned[];
  users: User[];
}) => () => ReadonlyArray<{ user: User; tasks: ReadonlyArray<Owned> }>;

/** Look tasks up by owner, with completed tasks under no key. */
export const supergrainOpenTasksByUser: OpenTasksByUser = (store) =>
  computedList(() => store.users, {
    open: { from: () => store.tasks, key: (task: Owned) => (task.completed ? null : task.ownerId) },
  })
    .filter((user) => user.active)
    .map((user, { open }) => ({ user, tasks: open.getAll(user.id) }));

/** The same, with the open tasks as a list of their own to look up in. */
export const supergrainOpenTasksByUserFromList: OpenTasksByUser = (store) => {
  const openTasks = computedList(() => store.tasks).filter((task) => !task.completed);
  return computedList(() => store.users, {
    open: { from: openTasks, key: (task: Owned) => task.ownerId },
  })
    .filter((user) => user.active)
    .map((user, { open }) => ({ user, tasks: open.getAll(user.id) }));
};

export const stableComputedOpenTasksByUser: OpenTasksByUser = (store) =>
  stableComputed(() => {
    const open = new Map<number, Owned[]>();
    for (const task of store.tasks) {
      const list = task.completed ? undefined : open.get(task.ownerId);
      if (list) list.push(task);
      else if (!task.completed) open.set(task.ownerId, [task]);
    }
    return store.users
      .filter((user) => user.active)
      .map((user) => ({ user, tasks: open.get(user.id) ?? [] }));
  });

/** The one-to-many query in TanStack DB's builder: a `toArray` include. */
export const tanstackOpenTasksByUser = (
  q: InitialQueryBuilder,
  tasks: Collection<Owned, number>,
  users: Collection<User, number>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see tanstackTopTen
): QueryBuilder<any> =>
  q
    .from({ user: users })
    .where(({ user }) => eq(user.active, true))
    .orderBy(({ user }) => user.id, "asc")
    .select(({ user }) => ({
      user,
      tasks: toArray(
        q
          .from({ task: tasks })
          .where(({ task }) => and(eq(task.ownerId, user.id), eq(task.completed, false)))
          .orderBy(({ task }) => task.id, "asc"),
      ),
    }));

// --- Grouping: open tasks counted per owner ---

/** The grouping query everywhere: "open tasks per owner, as counts, by owner id". */
export type CountsByOwner = (store: {
  tasks: Owned[];
}) => () => ReadonlyArray<{ ownerId: number; count: number }>;

/** The task changes from `oneToManyScenarios`, plus one no step reads. */
export function groupScenarios(
  size: number,
): ReadonlyArray<[title: string, change: (i: number) => JoinChange]> {
  return [
    ["Rename a task (nothing reads the title)", (i) => ({ task: 7, patch: { title: `t${i}` } })],
    ...oneToManyScenarios(size).filter(
      ([title]) => /\btask\b/.test(title) && !title.includes("user that"),
    ),
  ];
}

export const supergrainCountsByOwner: CountsByOwner = (store) =>
  computedList(() => store.tasks)
    .filter((task) => !task.completed)
    .groupBy((task) => task.ownerId)
    .map((group) => ({ ownerId: group.key, count: group.rows.length }))
    .orderBy((row) => row.ownerId);

export const stableComputedCountsByOwner: CountsByOwner = (store) =>
  stableComputed(() => {
    const counts = new Map<number, number>();
    for (const task of store.tasks) {
      if (!task.completed) counts.set(task.ownerId, (counts.get(task.ownerId) ?? 0) + 1);
    }
    return Array.from(counts, ([ownerId, n]) => ({ ownerId, count: n })).sort(
      (a, b) => a.ownerId - b.ownerId,
    );
  });

/** The grouping query in TanStack DB's builder. */
export const tanstackCountsByOwner = (
  q: InitialQueryBuilder,
  tasks: Collection<Owned, number>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see tanstackTopTen
): QueryBuilder<any> =>
  q
    .from({ task: tasks })
    .where(({ task }) => eq(task.completed, false))
    .groupBy(({ task }) => task.ownerId)
    .select(({ task }) => ({ ownerId: task.ownerId, count: count(task.id) }))
    .orderBy(({ task }) => task.ownerId, "asc");
