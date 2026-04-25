import { describe, it } from "vitest";

import { createReactive, effect } from "../../src";
import {
  RUN_SOAK,
  collectHeapSamples,
  expectCollectible,
  expectRetainedHeapBudget,
  expectTrendToFlatten,
} from "./helpers";

interface KernelLeaf {
  id: number;
  label: string;
  values: Array<number>;
}

function makeLeaves(seed: number, width = 24): Array<KernelLeaf> {
  return Array.from({ length: width }, (_, index) => ({
    id: seed * 1_000 + index,
    label: `leaf-${seed}-${index}`,
    values: Array.from({ length: 16 }, (__, offset) => seed + index + offset),
  }));
}

function runKernelCycle(seed: number): void {
  const state = createReactive({
    cursor: 0,
    leaves: makeLeaves(seed),
    nested: { depth: seed, flags: Array.from({ length: 8 }, (_, index) => index % 2 === 0) },
  });

  const stop = effect(() => {
    const current = state.leaves[state.cursor]!;
    void current.label;
    void current.values.reduce((sum, value) => sum + value, 0);
    void state.nested.depth;
    void state.nested.flags.filter(Boolean).length;
  });

  state.cursor = state.leaves.length - 1;
  state.leaves[0]!.label = `updated-${seed}`;
  state.nested.depth += 1;
  state.nested.flags = [...state.nested.flags].reverse();
  stop();
}

describe("kernel memory", () => {
  it("collects reactive roots, nested proxies, and subscriptions after teardown", async () => {
    await expectCollectible(() => {
      const raw = {
        leaves: makeLeaves(1, 8),
        nested: { depth: 1, active: true },
      };
      const state = createReactive(raw);
      const child = state.leaves[0]!;
      const stop = effect(() => {
        void state.leaves[0]!.label;
        void state.nested.depth;
      });

      state.leaves[0]!.label = "collect-me";
      state.nested.depth = 2;

      return {
        targets: [raw, state as object, child as object],
        teardown: () => stop(),
      };
    });
  });

  it("keeps retained heap bounded across repeated proxy and effect churn", async () => {
    await expectRetainedHeapBudget(() => {
      for (let index = 0; index < 180; index++) {
        runKernelCycle(index);
      }
    }, 2_500_000);
  });

  it("flattens retained heap across repeated proxy churn rounds", async () => {
    const samples = await collectHeapSamples(6, (round) => {
      for (let index = 0; index < 80; index++) {
        runKernelCycle(round * 1_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 2_500_000,
      maxPositiveDeltas: 4,
      maxLastDeltaBytes: 450_000,
    });
  });
});

describe.runIf(RUN_SOAK)("kernel memory soak", () => {
  it("stays flat during extended array and subscription churn", async () => {
    const samples = await collectHeapSamples(10, (round) => {
      for (let index = 0; index < 160; index++) {
        runKernelCycle(round * 10_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 4_000_000,
      maxPositiveDeltas: 6,
      maxLastDeltaBytes: 700_000,
    });
  });
});
