import { tracked } from "@supergrain/kernel/react";
import { collectBrowserSamples, expectBrowserTrend } from "@supergrain/test-utils/browser-memory";
import { cleanup, render, act } from "@testing-library/react";
import React from "react";
import { afterEach, describe, it } from "vitest";

import { type DocumentStore, type DocumentStoreConfig } from "../../src";
import { createDocumentStoreContext } from "../../src/react";

afterEach(() => cleanup());

interface User {
  id: string;
  attributes: { firstName: string; lastName: string; email: string };
}

interface Dashboard {
  totalActiveUsers: number;
  recentPostIds: Array<string>;
}

interface DashboardParams {
  workspaceId: number;
  filters: { active: boolean };
}

type TypeToModel = {
  user: User;
};

type TypeToQuery = {
  dashboard: { params: DashboardParams; result: Dashboard };
};

const { Provider, useDocument, useDocumentStore, useQuery } =
  createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();

function makeUser(id: string, firstName: string): User {
  return {
    id,
    attributes: {
      firstName,
      lastName: "Memory",
      email: `${id}@example.com`,
    },
  };
}

function makeDashboard(totalActiveUsers: number): Dashboard {
  return {
    totalActiveUsers,
    recentPostIds: ["1", "2", "3"],
  };
}

function makeStoreConfig(): DocumentStoreConfig<TypeToModel, TypeToQuery> {
  return {
    models: {
      user: {
        adapter: {
          async find() {
            throw new Error("browser memory test should not hit the adapter");
          },
        },
      },
    },
    queries: {
      dashboard: {
        adapter: {
          async find() {
            throw new Error("browser memory test should not hit the query adapter");
          },
        },
      },
    },
  };
}

const SiloHarness = tracked(function SiloHarness({
  workspaceId,
  seed,
}: {
  workspaceId: number;
  seed: number;
}) {
  const store = useDocumentStore();
  const user = useDocument("user", "1");
  const dashboard = useQuery("dashboard", { workspaceId, filters: { active: true } });

  return (
    <button
      data-testid="silo-memory"
      type="button"
      onClick={() => {
        store.clearMemory();
        store.insertDocument("user", makeUser("1", `Reset${seed}`));
        store.insertQueryResult(
          "dashboard",
          { workspaceId, filters: { active: true } },
          makeDashboard(seed),
        );
      }}
    >
      {user.data?.attributes.firstName}:{dashboard.data?.totalActiveUsers}
    </button>
  );
});

describe("silo react memory", () => {
  it("keeps Chromium heap flat across StrictMode Provider churn", async () => {
    // 6 rounds × 15 mounts (StrictMode = 2x effective) = 180 effective Provider mounts.
    const samples = await collectBrowserSamples(6, async (round) => {
      for (let index = 0; index < 15; index++) {
        const workspaceId = round * 200 + index + 1;
        const seed = round * 200 + index;
        const view = render(
          <React.StrictMode>
            <Provider
              config={makeStoreConfig()}
              initial={{
                model: { user: { "1": makeUser("1", `StrictUser${seed}`) } },
                query: {
                  dashboard: [
                    {
                      params: { workspaceId, filters: { active: true } },
                      result: makeDashboard(seed),
                    },
                  ],
                },
              }}
            >
              <SiloHarness workspaceId={workspaceId} seed={seed} />
            </Provider>
          </React.StrictMode>,
        );

        await act(async () => {
          view.getByTestId("silo-memory").click();
        });

        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 5_500_000,
      maxLastDeltaBytes: 1_200_000,
    });
  });

  // Intentionally creates a fresh config for each rerender to exercise
  // Provider teardown/remount when config object identity changes.
  it("keeps Chromium heap flat across changing workspaceId props", async () => {
    // 6 rounds × 15 prop-change rerenders = 90 cycles, exercising clearMemory
    // + new query subscription within the same Provider lifetime.
    const samples = await collectBrowserSamples(6, async (round) => {
      for (let index = 0; index < 15; index++) {
        const workspaceId = round * 300 + index + 1;
        const seed = round * 300 + index;
        const view = render(
          <Provider
            config={makeStoreConfig()}
            initial={{
              model: { user: { "1": makeUser("1", `PropUser${seed}`) } },
              query: {
                dashboard: [
                  {
                    params: { workspaceId, filters: { active: true } },
                    result: makeDashboard(seed),
                  },
                  {
                    params: { workspaceId: workspaceId + 1, filters: { active: true } },
                    result: makeDashboard(seed + 1),
                  },
                ],
              },
            }}
          >
            <SiloHarness workspaceId={workspaceId} seed={seed} />
          </Provider>,
        );

        await act(async () => {
          view.rerender(
            <Provider
              config={makeStoreConfig()}
              initial={{
                model: { user: { "1": makeUser("1", `PropUser${seed + 1}`) } },
                query: {
                  dashboard: [
                    {
                      params: { workspaceId: workspaceId + 1, filters: { active: true } },
                      result: makeDashboard(seed + 1),
                    },
                  ],
                },
              }}
            >
              <SiloHarness workspaceId={workspaceId + 1} seed={seed + 1} />
            </Provider>,
          );
          view.getByTestId("silo-memory").click();
        });

        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 5_500_000,
      maxLastDeltaBytes: 1_200_000,
      maxTailHeadRatio: 1.8,
    });
  });
});
