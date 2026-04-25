import { tracked } from "@supergrain/kernel/react";
import { cleanup, render, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";

import { useReactivePromise, useResource } from "../../src/react";

afterEach(() => cleanup());

interface HuskPayload {
  label: string;
  values: Array<number>;
}

function makePayload(seed: number, width = 18): Array<HuskPayload> {
  return Array.from({ length: width }, (_, index) => ({
    label: `payload-${seed}-${index}`,
    values: Array.from({ length: 14 }, (__, offset) => seed + index + offset),
  }));
}

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

const HuskHarness = tracked(function HuskHarness({ seed }: { seed: number }) {
  const resourceState = useResource({ cursor: 0, payload: makePayload(seed) }, (state) => {
    state.payload = makePayload(seed);
    return () => {
      state.payload = [];
    };
  });

  const promiseState = useReactivePromise(async (abortSignal) => {
    const current = resourceState.cursor;
    await Promise.resolve();
    if (abortSignal.aborted) return { label: "aborted", total: -1 };
    return {
      label: resourceState.payload[current]!.label,
      total: resourceState.payload[current]!.values.reduce((sum, value) => sum + value, 0),
    };
  });

  return (
    <button
      data-testid="husk-memory"
      type="button"
      onClick={() => {
        resourceState.cursor = (resourceState.cursor + 1) % resourceState.payload.length;
      }}
    >
      {promiseState.isReady ? promiseState.data?.total : resourceState.payload.length}
    </button>
  );
});

describe("husk react memory", () => {
  it("keeps Chromium heap flat across repeated hook mount and unmount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        const view = render(<HuskHarness seed={round * 100 + index} />);
        await vi.waitFor(() => expect(view.getByTestId("husk-memory").textContent).not.toBeNull());
        await act(async () => {
          view.getByTestId("husk-memory").click();
          view.getByTestId("husk-memory").click();
          await Promise.resolve();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 3_500_000,
      maxLastDeltaBytes: 850_000,
    });
  });
});
