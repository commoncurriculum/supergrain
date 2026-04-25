import { cleanup, render, act } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";

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
    /** Optional: tail-to-head ratio check (mean of last 2 vs first 2). */
    maxTailHeadRatio?: number;
  },
): void {
  expect(samples.length).toBeGreaterThanOrEqual(2);
  const totalGrowth = samples.at(-1)! - samples[0]!;
  const deltas = samples.slice(1).map((sample, index) => sample - samples[index]!);
  expect(totalGrowth, "total heap growth exceeded budget").toBeLessThanOrEqual(
    options.maxGrowthBytes,
  );
  expect(deltas.at(-1) ?? 0, "last-round heap delta exceeded budget").toBeLessThanOrEqual(
    options.maxLastDeltaBytes,
  );
  if (options.maxTailHeadRatio !== undefined && samples.length >= 4) {
    const headAvg = (samples[0]! + samples[1]!) / 2;
    const tailAvg = (samples.at(-1)! + samples.at(-2)!) / 2;
    if (headAvg > 0) {
      expect(
        tailAvg / headAvg,
        "tail-to-head heap ratio indicates sustained monotonic growth",
      ).toBeLessThanOrEqual(options.maxTailHeadRatio);
    }
  }
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

  it("keeps Chromium heap flat across StrictMode double-mount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        const view = render(
          <React.StrictMode>
            <KernelHarness seed={round * 200 + index} />
          </React.StrictMode>,
        );
        await act(async () => {
          view.getByTestId("kernel-memory").click();
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

  it("keeps Chromium heap flat with concurrent component trees", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 4; index++) {
        const base = round * 400 + index * 4;
        const views = [
          render(<KernelHarness seed={base} />),
          render(<KernelHarness seed={base + 1} />),
          render(<KernelHarness seed={base + 2} />),
          render(<KernelHarness seed={base + 3} />),
        ];
        await act(async () => {
          for (const view of views) {
            view.getByTestId("kernel-memory").click();
          }
        });
        for (const view of views) {
          view.unmount();
        }
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 900_000,
      maxTailHeadRatio: 1.8,
    });
  });
});
