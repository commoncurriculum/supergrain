import {
  HAS_GC,
  assertGcAvailable,
  collectHeapSamples,
  expectTrendToFlatten,
} from "@supergrain/test-utils/memory";
import { describe, it } from "vitest";

import { settleStoreRound } from "./fixtures";

it("GC is exposed (required for silo soak)", () => {
  assertGcAvailable();
});

describe.runIf(HAS_GC)("silo memory soak", () => {
  it("stays flat during extended async finder churn", async () => {
    const samples = await collectHeapSamples(10, async (round) => {
      for (let index = 0; index < 60; index++) {
        await settleStoreRound(round * 10_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 6_000_000,
      maxLastDeltaBytes: 900_000,
      maxTailHeadRatio: 2.0,
    });
  });
});
