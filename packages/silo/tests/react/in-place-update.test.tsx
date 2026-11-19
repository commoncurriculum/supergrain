import { unwrap } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Schedule } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { createDocumentStore, type DocumentStore } from "../../src";
import { createDocumentStoreContext } from "../../src/react";

interface Report {
  id: string;
  title: string;
  rows: Array<{ id: string; total: number }>;
}

type Models = { report: Report };
type Queries = { reports: { params: { week: number }; result: Report } };

const { Provider, useDocument } = createDocumentStoreContext<DocumentStore<Models, Queries>>();

afterEach(() => {
  cleanup();
});

describe("inserting a new version of a loaded document", () => {
  it("updates it in place, re-rendering only components that read a changed field", () => {
    const store = createDocumentStore<Models, Queries>({
      models: { report: { adapter: { find: () => Promise.resolve([]) } } },
      retry: Schedule.recurs(0),
    });
    store.insertDocument("report", {
      id: "report_1",
      title: "Weekly",
      rows: [
        { id: "row_1", total: 1 },
        { id: "row_2", total: 2 },
      ],
    });
    const stored = store.find("report", "report_1").value;
    const renders = { title: 0, row_1: 0, row_2: 0 };

    const Title = tracked(function Title() {
      renders.title++;
      return <h1 data-testid="title">{useDocument("report", "report_1").value?.title}</h1>;
    });
    const Row = tracked(function Row({ index }: { index: number }) {
      const row = useDocument("report", "report_1").value!.rows[index]!;
      renders[row.id as "row_1" | "row_2"]++;
      return <span data-testid={row.id}>{row.total}</span>;
    });

    render(
      <Provider store={store}>
        <Title />
        <Row index={0} />
        <Row index={1} />
      </Provider>,
    );
    const afterMount = { ...renders };

    act(() => {
      store.insertDocument("report", {
        id: "report_1",
        title: "Weekly",
        rows: [
          { id: "row_1", total: 1 },
          { id: "row_2", total: 20 },
        ],
      });
    });

    expect(screen.getByTestId("row_2").textContent).toBe("20");
    expect(store.find("report", "report_1").value).toBe(stored);
    expect(renders.title).toBe(afterMount.title);
    expect(renders.row_1).toBe(afterMount.row_1);
    expect(renders.row_2).toBe(afterMount.row_2 + 1);
  });
});

describe("inserting a new version with onRefetch: 'replace'", () => {
  it("swaps in the new object for documents and query results, re-rendering every reader", () => {
    const store = createDocumentStore<Models, Queries>({
      models: { report: { adapter: { find: () => Promise.resolve([]) }, onRefetch: "replace" } },
      queries: { reports: { adapter: { find: () => Promise.resolve([]) }, onRefetch: "replace" } },
      retry: Schedule.recurs(0),
    });
    const first: Report = { id: "report_1", title: "Weekly", rows: [{ id: "row_1", total: 1 }] };
    store.insertDocument("report", first);
    store.insertQueryResult("reports", { week: 1 }, first);
    let titleRenders = 0;

    const Title = tracked(function Title() {
      titleRenders++;
      return <h1>{useDocument("report", "report_1").value?.title}</h1>;
    });
    render(
      <Provider store={store}>
        <Title />
      </Provider>,
    );
    const afterMount = titleRenders;

    const next: Report = { id: "report_1", title: "Weekly", rows: [{ id: "row_1", total: 10 }] };
    act(() => {
      store.insertDocument("report", next);
      store.insertQueryResult("reports", { week: 1 }, next);
    });

    expect(unwrap(store.findInMemory("report", "report_1"))).toBe(next);
    expect(unwrap(store.findQueryInMemory("reports", { week: 1 }))).toBe(next);
    expect(first.rows[0]!.total).toBe(1);
    expect(titleRenders).toBe(afterMount + 1);
  });
});
