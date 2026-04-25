import { tracked } from "@supergrain/kernel/react";
import { cleanup, render, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";

import { type DocumentStore, type DocumentStoreConfig } from "../../src";
import { createDocumentStoreContext } from "../../src/react";

afterEach(() => cleanup());

async function forceBrowserGc(cycles = 4): Promise<void> {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };
  if (typeof runtime.gc !== "function") {
    throw new Error("Browser memory tests require Chromium to expose gc().");
  }
  for (let index = 0; index < cycles; index++) {
    runtime.gc();
    await Promise.resolve();
  }
}

async function browserHeapUsed(): Promise<number> {
  const session = cdp() as { send: (method: string) => Promise<unknown> };
  await session.send("Performance.enable");
  const result = (await session.send("Performance.getMetrics")) as {
    metrics: Array<{ name: string; value: number }>;
  };
  const heap = result.metrics.find((metric) => metric.name === "JSHeapUsedSize");
  if (!heap) {
    throw new Error("Unable to read JSHeapUsedSize from Chromium metrics.");
  }
  return heap.value;
}

async function collectBrowserSamples(
  rounds: number,
  runRound: (round: number) => void | Promise<void>,
): Promise<Array<number>> {
  const samples: Array<number> = [];
  for (let round = 0; round < rounds; round++) {
    await runRound(round);
    await forceBrowserGc();
    samples.push(await browserHeapUsed());
  }
  return samples;
}

function expectBrowserTrend(
  samples: ReadonlyArray<number>,
  options: {
    maxGrowthBytes: number;
    maxLastDeltaBytes: number;
  },
): void {
  expect(samples.length).toBeGreaterThanOrEqual(2);
  const totalGrowth = samples.at(-1)! - samples[0]!;
  const deltas = samples.slice(1).map((sample, index) => sample - samples[index]!);
  expect(totalGrowth).toBeLessThanOrEqual(options.maxGrowthBytes);
  expect(deltas.at(-1) ?? 0).toBeLessThanOrEqual(options.maxLastDeltaBytes);
}

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
  it("keeps Chromium heap flat across repeated Provider mount and unmount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        const workspaceId = round * 100 + index + 1;
        const seed = round * 100 + index;
        const view = render(
          <Provider
            config={makeStoreConfig()}
            initial={{
              model: {
                user: {
                  "1": makeUser("1", `User${seed}`),
                },
              },
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
          </Provider>,
        );

        await act(async () => {
          view.getByTestId("silo-memory").click();
        });

        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 900_000,
    });
  });
});
