import { useResource } from "@supergrain/husk/react";
import { tracked } from "@supergrain/kernel/react";
import { collectBrowserSamples, expectBrowserTrend } from "@supergrain/test-utils/browser-memory";
import { act, cleanup, render, within } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, it } from "vitest";

import { type DocumentStore, type DocumentStoreConfig } from "../../src";
import { createDocumentStoreContext } from "../../src/react";

afterEach(() => cleanup());

// Realistic app shape: Provider mounts once per session, list view loads via
// useQuery, clicking an item mounts a detail view that combines useDocument
// with useResource for derived/enriched data. Closing the detail unmounts it.
// Pagination flips the query params. This is the integrated lifecycle that
// matters for production confidence — it exercises Provider, query, document,
// resource, conditional component mount/unmount, prop changes, and full
// teardown all under StrictMode double-invocation.

interface Item {
  id: string;
  name: string;
  payload: Array<number>;
}
interface ListParams {
  page: number;
}
type Models = { item: Item };
type Queries = { itemList: { params: ListParams; result: Array<Item> } };

const { Provider, useDocument, useQuery } =
  createDocumentStoreContext<DocumentStore<Models, Queries>>();

function makeItem(page: number, idx: number): Item {
  return {
    id: `item-${page}-${idx}`,
    name: `Item ${page}.${idx}`,
    payload: Array.from({ length: 12 }, (_, i) => page + idx + i),
  };
}

function makeStoreConfig(seed: number): DocumentStoreConfig<Models, Queries> {
  return {
    models: {
      item: {
        adapter: {
          async find(ids) {
            return ids.map((id) => {
              const m = id.match(/^item-(\d+)-(\d+)$/);
              return m ? makeItem(Number(m[1]), Number(m[2])) : makeItem(seed, 0);
            });
          },
        },
      },
    },
    queries: {
      itemList: {
        adapter: {
          async find(paramsList) {
            return paramsList.map((p) => Array.from({ length: 6 }, (_, i) => makeItem(p.page, i)));
          },
        },
      },
    },
    batchWindowMs: 1,
  };
}

const ItemDetail = tracked(function ItemDetail({ id }: { id: string }) {
  const handle = useDocument("item", id);
  // Derived async work tied to the doc: a husk resource that recomputes when
  // the doc data changes. Real apps frequently combine doc subscriptions with
  // local async work (formatting, derivations, side fetches).
  const enriched = useResource(
    { summary: null as string | null },
    async (state, { abortSignal }) => {
      const data = handle.data;
      if (!data) return;
      await Promise.resolve();
      if (abortSignal.aborted) return;
      state.summary = `${data.name} (sum=${data.payload.reduce((a, b) => a + b, 0)})`;
    },
  );
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-testid="detail">
      <button data-testid="toggle-expand" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "collapse" : "expand"}
      </button>
      <span>{enriched.summary ?? handle.data?.name ?? "..."}</span>
      {expanded && <span data-testid="expanded">{handle.data?.payload.join(",")}</span>}
    </div>
  );
});

const App = tracked(function App({ initialPage }: { initialPage: number }) {
  const [page, setPage] = useState(initialPage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useQuery("itemList", { page });
  return (
    <div>
      <button data-testid="next-page" onClick={() => setPage((p) => p + 1)}>
        next
      </button>
      <button data-testid="close-detail" onClick={() => setSelectedId(null)}>
        close
      </button>
      {(list.data ?? []).map((item) => (
        <button
          key={item.id}
          data-testid={`select-${item.id}`}
          onClick={() => setSelectedId(item.id)}
        >
          {item.name}
        </button>
      ))}
      {selectedId && <ItemDetail id={selectedId} />}
    </div>
  );
});

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe("realistic app workflow memory", () => {
  // 5 rounds; each round is one full app session: mount → 60 user actions
  // (item selects, expand toggles, closes, paginations) → unmount. After
  // unmount the entire Provider + store + queries + documents + resources +
  // their effects must be releasable. If any path retains references across
  // the unmount boundary, retained heap climbs across rounds and trips the
  // budget or tail/head ratio.
  it("keeps Chromium heap flat across simulated user sessions", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      const view = render(
        <React.StrictMode>
          <Provider config={makeStoreConfig(round * 1_000)} initial={{}}>
            <App initialPage={round * 100} />
          </Provider>
        </React.StrictMode>,
      );
      // Wait for initial query to resolve.
      await flushAsync();

      let currentPage = round * 100;
      for (let action = 0; action < 60; action++) {
        const itemIdx = action % 6;
        const itemId = `item-${currentPage}-${itemIdx}`;
        const select = within(view.container).queryByTestId(`select-${itemId}`);
        if (select) {
          await act(async () => {
            select.click();
          });
          // Let detail mount, useDocument fetch, useResource resolve.
          await flushAsync();
          // Toggle expand on the detail (local state churn while subscribed).
          const expand = within(view.container).queryByTestId("toggle-expand");
          if (expand) {
            await act(async () => {
              expand.click();
            });
            await act(async () => {
              expand.click();
            });
          }
          await act(async () => {
            within(view.container).getByTestId("close-detail").click();
          });
        }
        if (action % 6 === 5) {
          // Paginate — query params change, previous query subscription teardown.
          await act(async () => {
            within(view.container).getByTestId("next-page").click();
          });
          currentPage++;
          await flushAsync();
        }
      }

      view.unmount();
      cleanup();
    });

    expectBrowserTrend(samples, {
      // ~300 detail mount/unmount + ~50 query param changes + StrictMode 2x
      // per session × 5 sessions. Healthy retention plateaus well under this.
      maxGrowthBytes: 6_000_000,
      maxLastDeltaBytes: 1_500_000,
      maxTailHeadRatio: 1.8,
    });
  });
});
