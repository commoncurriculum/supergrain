import { cleanup, render, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser/context";

import { tracked, useReactive } from "../../src/react";

afterEach(() => cleanup());

interface BrowserLeaf {
  label: string;
  values: Array<number>;
}

function makePayload(seed: number, width = 20): Array<BrowserLeaf> {
  return Array.from({ length: width }, (_, index) => ({
    label: `leaf-${seed}-${index}`,
    values: Array.from({ length: 16 }, (__, offset) => seed + index + offset),
  }));
}

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

const KernelHarness = tracked(function KernelHarness({ seed }: { seed: number }) {
  const state = useReactive({
    cursor: 0,
    leaves: makePayload(seed),
  });

  return (
    <button
      data-testid="kernel-memory"
      type="button"
      onClick={() => {
        state.cursor = (state.cursor + 1) % state.leaves.length;
        state.leaves[0]!.label = `updated-${seed}-${state.cursor}`;
      }}
    >
      {state.leaves[state.cursor]!.values[0]}
    </button>
  );
});

describe("kernel react memory", () => {
  it("keeps Chromium heap flat across repeated mount and unmount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 10; index++) {
        const view = render(<KernelHarness seed={round * 100 + index} />);
        await act(async () => {
          view.getByTestId("kernel-memory").click();
          view.getByTestId("kernel-memory").click();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 3_000_000,
      maxLastDeltaBytes: 700_000,
    });
  });
});
