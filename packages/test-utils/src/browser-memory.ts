import { expect } from "vitest";
import { cdp } from "vitest/browser";

export async function forceBrowserGc(cycles = 4): Promise<void> {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };
  if (typeof runtime.gc !== "function") {
    throw new TypeError("Browser memory tests require Chromium to expose gc().");
  }
  for (let index = 0; index < cycles; index++) {
    runtime.gc();
    await Promise.resolve();
  }
}

interface CdpSession {
  send: (method: string) => Promise<unknown>;
}

let performanceEnabled = false;

export async function browserHeapUsed(): Promise<number> {
  const session = cdp() as CdpSession;
  if (!performanceEnabled) {
    await session.send("Performance.enable");
    performanceEnabled = true;
  }
  const result = (await session.send("Performance.getMetrics")) as {
    metrics: Array<{ name: string; value: number }>;
  };
  const heap = result.metrics.find((metric) => metric.name === "JSHeapUsedSize");
  if (!heap) {
    throw new Error("Unable to read JSHeapUsedSize from Chromium metrics.");
  }
  return heap.value;
}

export async function collectBrowserSamples(
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

export interface BrowserTrendOptions {
  maxGrowthBytes: number;
  maxLastDeltaBytes: number;
  /** Tail-to-head ratio check (mean of last 2 vs first 2). Requires ≥ 4 samples. */
  maxTailHeadRatio?: number;
}

export function expectBrowserTrend(
  samples: ReadonlyArray<number>,
  options: BrowserTrendOptions,
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
