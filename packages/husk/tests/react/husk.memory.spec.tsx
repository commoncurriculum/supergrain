import { tracked } from "@supergrain/kernel/react";
import { cleanup, render, act } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
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
  it("keeps Chromium heap flat when component unmounts while async is still pending", async () => {
    // Mounts the harness, triggers a click (which starts a reactivePromise rerun),
    // then immediately unmounts before the promise resolves.
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        const view = render(<HuskHarness seed={round * 100 + index} />);
        // Click without waiting — unmount races the in-flight promise
        view.getByTestId("husk-memory").click();
        view.unmount();
        // Drain microtasks so aborted promises settle
        await act(async () => {
          await Promise.resolve();
        });
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 3_500_000,
      maxLastDeltaBytes: 850_000,
    });
  });

  it("keeps Chromium heap flat across repeated remounts with changing seed props", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        // Render with one seed then rerender with a different seed to exercise
        // prop-change teardown/setup within the same DOM container.
        const view = render(<HuskHarness seed={round * 200 + index * 2} />);
        await act(async () => {
          view.rerender(<HuskHarness seed={round * 200 + index * 2 + 1} />);
          await Promise.resolve();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 900_000,
      maxTailHeadRatio: 1.8,
    });
  });

  it("keeps Chromium heap flat across StrictMode double-mount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 6; index++) {
        const view = render(
          <React.StrictMode>
            <HuskHarness seed={round * 300 + index} />
          </React.StrictMode>,
        );
        await act(async () => {
          view.getByTestId("husk-memory").click();
          await Promise.resolve();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 950_000,
    });
  });
});
