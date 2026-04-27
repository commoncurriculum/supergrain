import {
  HAS_GC,
  assertGcAvailable,
  collectHeapSamples,
  expectTrendToFlatten,
} from "@supergrain/test-utils/memory";
import { describe, it } from "vitest";

import { runHuskCycle } from "./fixtures";

it("GC is exposed (required for husk soak)", () => {
  assertGcAvailable();
});

describe.runIf(HAS_GC)("husk memory soak", () => {
  it("stays flat during extended async rerun churn", async () => {
    const samples = await collectHeapSamples(10, async (round) => {
      for (let index = 0; index < 100; index++) {
        await runHuskCycle(round * 10_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 5_000_000,
      maxLastDeltaBytes: 850_000,
      maxTailHeadRatio: 2.0,
    });
  });
});
