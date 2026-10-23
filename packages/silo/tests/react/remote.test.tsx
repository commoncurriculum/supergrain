import { tracked } from "@supergrain/kernel/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Schedule } from "effect";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createRemoteQueryStore, remoteQuery, type RemoteQueryStoreConfig } from "../../src";
import { createRemoteQueryStoreContext } from "../../src/react";

interface Body {
  filters: { groupId: number };
}

interface Summary {
  groupId: number;
  rows: Array<{ id: string; total: number }>;
}

interface Request {
  path: string;
}

const summaryQuery = remoteQuery<Body, Summary, Request>("summary", { path: "/summary" });

const { Provider, useRemoteQuery } = createRemoteQueryStoreContext<Request>();

// Real time: React's scheduler and effects don't run under fake timers in the browser.
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/**
 * A server whose totals can be changed between requests. Every request is
 * recorded, so a test can count fetches per group.
 */
function makeServer() {
  const totals = new Map<number, Array<number>>();
  const requests: Array<{ path: string; groupId: number }> = [];
  let failing = false;
  const fetch: RemoteQueryStoreConfig<Request>["fetch"] = async (request, params) => {
    const { groupId } = (params as Body).filters;
    requests.push({ path: request.path, groupId });
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (failing) throw new Error("500");
    const groupTotals = totals.get(groupId) ?? [1, 2];
    return {
      groupId,
      rows: groupTotals.map((total, index) => ({ id: `row_${index + 1}`, total })),
    } satisfies Summary;
  };
  return {
    fetch,
    requests,
    setTotals: (groupId: number, values: Array<number>) => totals.set(groupId, values),
    fail: (value: boolean) => {
      failing = value;
    },
    count: (groupId: number) => requests.filter((request) => request.groupId === groupId).length,
  };
}

function body(groupId: number): Body {
  return { filters: { groupId } };
}

const Rows = tracked(function Rows({
  groupId,
  renders,
  staleTime,
  refetchInterval,
}: {
  groupId: number;
  renders?: Record<string, number>;
  staleTime?: number;
  refetchInterval?: number;
}) {
  const summary = useRemoteQuery(summaryQuery, body(groupId), { staleTime, refetchInterval });
  if (summary.value === undefined) return <span data-testid={`loading-${groupId}`}>loading</span>;
  return (
    <ul>
      {summary.value.rows.map((row, index) => (
        <Row key={row.id} groupId={groupId} index={index} renders={renders} />
      ))}
    </ul>
  );
});

const Row = tracked(function Row({
  groupId,
  index,
  renders,
}: {
  groupId: number;
  index: number;
  renders?: Record<string, number>;
}) {
  const row = useRemoteQuery(summaryQuery, body(groupId)).value!.rows[index]!;
  if (renders) renders[row.id] = (renders[row.id] ?? 0) + 1;
  return <li data-testid={`${groupId}-${row.id}`}>{row.total}</li>;
});

afterEach(() => {
  cleanup();
});

describe("useRemoteQuery", () => {
  it("loads once under StrictMode, then refetches in place on refetch()", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({
      fetch: server.fetch,
      staleTime: 1000,
      retry: Schedule.recurs(0),
    });
    const renders: Record<string, number> = {};

    render(
      <StrictMode>
        <Provider store={store}>
          <Rows groupId={1} renders={renders} />
        </Provider>
      </StrictMode>,
    );
    expect(screen.getByTestId("loading-1")).toBeTruthy();
    await wait(20);

    expect(screen.getByTestId("1-row_2").textContent).toBe("2");
    expect(server.requests).toEqual([{ path: "/summary", groupId: 1 }]);
    const handle = store.find(summaryQuery, body(1));
    const loaded = handle.value;
    const afterLoad = { ...renders };

    server.setTotals(1, [1, 20]);
    await act(() => handle.refetch());

    expect(screen.getByTestId("1-row_2").textContent).toBe("20");
    expect(handle.value).toBe(loaded);
    expect(renders.row_1).toBe(afterLoad.row_1);
    expect(renders.row_2).toBeGreaterThan(afterLoad.row_2!);
  });

  it("refetches on mount only once the result is older than that component's staleTime", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch, staleTime: 60 });
    const Total = tracked(function Total({ staleTime }: { staleTime?: number }) {
      return <span>{useRemoteQuery(summaryQuery, body(1), { staleTime }).value?.groupId}</span>;
    });
    const mount = (staleTime?: number) =>
      render(
        <Provider store={store}>
          <Total staleTime={staleTime} />
        </Provider>,
      );

    mount().unmount();
    await wait(20);
    mount().unmount();
    await wait(10);
    expect(server.count(1)).toBe(1);

    await wait(60);
    mount(Infinity).unmount();
    await wait(10);
    expect(server.count(1)).toBe(1);

    mount().unmount();
    await wait(10);
    expect(server.count(1)).toBe(2);
  });

  it("drops a result gcTime after its last component unmounts", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({
      fetch: server.fetch,
      staleTime: Infinity,
      gcTime: 40,
    });

    const { unmount } = render(
      <Provider store={store}>
        <Rows groupId={1} />
      </Provider>,
    );
    await wait(60);
    expect(store.find(summaryQuery, body(1)).value?.groupId).toBe(1);
    expect(server.count(1)).toBe(1);

    unmount();
    await wait(20);
    expect(store.find(summaryQuery, body(1)).value?.groupId).toBe(1);

    await wait(40);
    expect(store.find(summaryQuery, body(1)).value).toBeUndefined();
    await wait(1);
    expect(server.count(1)).toBe(2);
  });

  it("invalidates every body, or only bodies containing the given fields", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch, staleTime: Infinity });
    store.find(summaryQuery, body(3));

    render(
      <Provider store={store}>
        <Rows groupId={1} />
        <Rows groupId={2} />
      </Provider>,
    );
    await wait(20);
    expect([server.count(1), server.count(2), server.count(3)]).toEqual([1, 1, 1]);

    server.setTotals(1, [5, 6]);
    act(() => store.invalidate(summaryQuery, { filters: { groupId: 1 } }));
    await wait(20);
    expect([server.count(1), server.count(2)]).toEqual([2, 1]);
    expect(screen.getByTestId("1-row_1").textContent).toBe("5");

    act(() => store.invalidate(summaryQuery));
    await wait(20);
    expect([server.count(1), server.count(2), server.count(3)]).toEqual([3, 2, 1]);

    render(
      <Provider store={store}>
        <Rows groupId={3} />
      </Provider>,
    );
    await wait(20);
    expect(server.count(3)).toBe(2);
  });

  it("refetches on an interval, on focus and on reconnect while mounted", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch });

    const { unmount } = render(
      <Provider store={store}>
        <Rows groupId={1} refetchInterval={30} />
        <Rows groupId={2} />
      </Provider>,
    );
    await wait(100);
    expect(server.count(1)).toBeGreaterThanOrEqual(3);
    // The rows mounted inside the last `act` observe as it ends, and refetch.
    await wait(10);
    const settled = server.count(2);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wait(10);
    expect(server.count(2)).toBe(settled + 1);

    act(() => {
      globalThis.dispatchEvent(new Event("online"));
    });
    await wait(10);
    expect(server.count(2)).toBe(settled + 2);

    // A fetch already in flight isn't restarted by focus.
    act(() => {
      void store.find(summaryQuery, body(2)).refetch();
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wait(10);
    expect(server.count(2)).toBe(settled + 3);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      await wait(10);
      const hidden = [server.count(1), server.count(2)];
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await wait(80);
      expect([server.count(1), server.count(2)]).toEqual(hidden);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }

    unmount();
    const afterUnmount = server.count(1);
    await wait(80);
    expect(server.count(1)).toBe(afterUnmount);
  });

  it("waits without fetching while params are null, and throws outside a Provider", async () => {
    const server = makeServer();
    const store = createRemoteQueryStore<Request>({ fetch: server.fetch });
    const Pending = tracked(function Pending() {
      return <span data-testid="pending">{useRemoteQuery(summaryQuery, null).status}</span>;
    });

    render(
      <Provider store={store}>
        <Pending />
      </Provider>,
    );
    await wait(20);
    expect(screen.getByTestId("pending").textContent).toBe("pending");
    expect(server.requests).toEqual([]);

    expect(() => render(<Pending />)).toThrow(/must be used within the Provider/);
  });
});
