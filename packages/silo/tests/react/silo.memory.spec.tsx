import { cleanup, render, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser/context";

import { tracked } from "@supergrain/kernel/react";

import { type DocumentStore } from "../../src";
import { createDocumentStoreContext } from "../../src/react";
import {
  makeDashboard,
  makeStoreConfig,
  makeUser,
  type TypeToModel,
  type TypeToQuery,
} from "../example-app";

afterEach(() => cleanup());

async function forceBrowserGc(cycles = 4): Promise<void> {
  await page.evaluate(async (iterations) => {
    const runtime = globalThis as typeof globalThis & { gc?: () => void };
    if (typeof runtime.gc !== "function") {
      throw new Error("Browser memory tests require Chromium to expose gc().");
    }
    for (let index = 0; index < iterations; index++) {
      runtime.gc();
      await Promise.resolve();
    }
  }, cycles);
}

async function browserHeapUsed(): Promise<number> {
  const session = cdp();
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

const { Provider, useDocument, useDocumentStore, useQuery } =
  createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();

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
        store.insertDocument("user", makeUser("1", { firstName: `Reset${seed}` }));
        store.insertQueryResult(
          "dashboard",
          { workspaceId, filters: { active: true } },
          makeDashboard({ totalActiveUsers: seed }),
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
                  "1": makeUser("1", { firstName: `User${seed}` }),
                },
              },
              query: {
                dashboard: [
                  {
                    params: { workspaceId, filters: { active: true } },
                    result: makeDashboard({ totalActiveUsers: seed }),
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
