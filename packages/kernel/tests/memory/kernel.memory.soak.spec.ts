import {
  HAS_GC,
  assertGcAvailable,
  collectHeapSamples,
  expectTrendToFlatten,
} from "@supergrain/test-utils/memory";
import { describe, it } from "vitest";

import { runKernelCycle } from "./fixtures";

it("GC is exposed (required for kernel soak)", () => {
  assertGcAvailable();
});

describe.runIf(HAS_GC)("kernel memory soak", () => {
  it("stays flat during extended array and subscription churn", async () => {
    const samples = await collectHeapSamples(10, (round) => {
      for (let index = 0; index < 160; index++) {
        runKernelCycle(round * 10_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 700_000,
      maxTailHeadRatio: 2.0,
    });
  });
});
