import { For, tracked } from "@supergrain/kernel/react";
import { useLiveQuery } from "@tanstack/react-db";
import { act, render } from "@testing-library/react";
import React, { memo, type FC } from "react";
import { bench, describe } from "vitest";

import {
  liveQueryTopTen,
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
} from "../live-query-fixtures";

/**
 * The `live-query.bench.ts` comparison, rendered by React 19 in Chromium.
 *
 * Each app renders the top 10 tasks as a list, one row component per task,
 * the way each library recommends:
 * - supergrain: `tracked` list and rows. The list reads the query, with a
 *   plain `.map()` or with `<For>`; each row reads its own task's fields, so
 *   a field edit re-renders only that row. (`<For parent>` isn't included: it
 *   doesn't update when a slot is replaced without the length changing, which
 *   is how a top-10 list changes.)
 * - TanStack DB: `useLiveQuery` in the list, `memo` rows. A changed task is a
 *   new object, so the list and that row re-render.
 *
 * Each benchmark is one change, wrapped in `act()` so React commits it to the
 * DOM before the iteration ends. Before timing, every app runs the same edits
 * and must show the same DOM, and the renders each change causes are printed.
 */

const renders = { list: 0, row: 0 };

const RowView: FC<{ task: Task }> = ({ task }) => {
  renders.row++;
  return (
    <li>
      {task.title} · p{task.priority}
    </li>
  );
};

// --- supergrain ---

const SupergrainRow = tracked(RowView);

type ListProps = { query: () => ReadonlyArray<Task> };

/** Plain `.map()`: the list re-renders whenever a slot of the result changes. */
const MapList = tracked(({ query }: ListProps) => {
  renders.list++;
  return (
    <ul>
      {query().map((task) => (
        <SupergrainRow key={task.id} task={task} />
      ))}
    </ul>
  );
});

/** `<For>`: one tracked item per slot, so a changed slot re-renders only itself. */
const ForList = tracked(({ query }: ListProps) => {
  renders.list++;
  return (
    <ul>
      <For each={query() as Task[]}>{(task) => <SupergrainRow key={task.id} task={task} />}</For>
    </ul>
  );
});

// --- TanStack DB ---

const TanstackRow = memo(RowView);

function TanstackList({ collection }: { collection: TanstackTasks["collection"] }) {
  renders.list++;
  // An explicit `queryKey` skips rebuilding and hashing the query on every
  // render, as TanStack DB recommends for hot render paths.
  const { data } = useLiveQuery({
    queryKey: ["top-ten", collection.id],
    query: (q) => tanstackTopTen(q, collection),
  });
  return (
    <ul>
      {(data as Task[]).map((task) => (
        <TanstackRow key={task.id} task={task} />
      ))}
    </ul>
  );
}

// --- harness ---

/** A mounted app: edit tasks (React commits before this returns), read the rows shown. */
interface App {
  edit(changes: Edit): void;
  shown(): string[];
  unmount(): void;
}

type Mount = (tasks: Task[]) => App;

function mount(element: React.ReactElement, edit: (changes: Edit) => void): App {
  let view!: ReturnType<typeof render>;
  act(() => {
    view = render(element);
  });
  return {
    edit: (changes) => act(() => edit(changes)),
    shown: () => Array.from(view.container.querySelectorAll("li"), (li) => li.textContent ?? ""),
    unmount: () => view.unmount(),
  };
}

const supergrain =
  (makeQuery: SupergrainQuery, List: FC<ListProps> = MapList): Mount =>
  (tasks) => {
    const { store, edit } = supergrainStore(tasks);
    return mount(<List query={makeQuery(store)} />, edit);
  };

const tanstack =
  (setup: (tasks: Task[]) => TanstackTasks): Mount =>
  (tasks) => {
    // No collection cleanup: `useLiveQuery` owns a live query over it, and
    // TanStack DB garbage-collects both once the list unmounts.
    const { collection, edit } = setup(tasks);
    return mount(<TanstackList collection={collection} />, edit);
  };

const APPS: ReadonlyArray<[string, Mount]> = [
  ["supergrain liveQuery", supergrain(liveQueryTopTen)],
  ["supergrain liveQuery + <For>", supergrain(liveQueryTopTen, ForList)],
  ["supergrain stableComputed", supergrain(stableComputedTopTen)],
  ["TanStack DB (sync write)", tanstack(tanstackSyncWrite)],
  ["TanStack DB (optimistic update)", tanstack(tanstackOptimisticUpdate)],
];

/** Run the same edits in every app; throw if any shows different rows. */
function validate(size: number): void {
  const results = APPS.map(([name, mountApp]) => {
    const app = mountApp(makeTasks(size));
    const seen = [app.shown()];
    for (const edit of validationEdits(size)) {
      app.edit(edit);
      seen.push(app.shown());
    }
    app.unmount();
    return [name, JSON.stringify(seen)] as const;
  });
  for (const [name, seen] of results) {
    if (seen !== results[0]![1]) {
      throw new Error(
        `react live-query bench: ${name} disagrees with ${results[0]![0]} at ${size} rows`,
      );
    }
  }
}

/** Print how many list and row renders one change causes in each app. */
function reportRenders(size: number): void {
  const lines = [`React renders per change (${size.toLocaleString("en-US")} rows):`];
  for (const [title, edit] of scenarios(size)) {
    lines.push(`  ${title}`);
    for (const [name, mountApp] of APPS) {
      const app = mountApp(makeTasks(size));
      app.edit(edit(0));
      renders.list = 0;
      renders.row = 0;
      app.edit(edit(1));
      lines.push(`    ${name}: list ${renders.list}, rows ${renders.row}`);
      app.unmount();
    }
  }
  console.log(lines.join("\n"));
}

for (const size of [1_000, 10_000]) {
  validate(size);
  reportRenders(size);
  const rows = `${size.toLocaleString("en-US")} rows`;

  describe(`Mount the list (${rows})`, () => {
    for (const [name, mountApp] of APPS) {
      const tasks = makeTasks(size);
      bench(name, () => {
        mountApp(tasks.map((task) => ({ ...task }))).unmount();
      });
    }
  });

  for (const [title, edit] of scenarios(size)) {
    describe(`${title} (${rows})`, () => {
      for (const [name, mountApp] of APPS) {
        let app: App | undefined;
        let i = 0;
        bench(
          name,
          () => {
            app!.edit(edit(i++));
          },
          {
            setup: () => {
              app ??= mountApp(makeTasks(size));
            },
          },
        );
      }
    });
  }
}
