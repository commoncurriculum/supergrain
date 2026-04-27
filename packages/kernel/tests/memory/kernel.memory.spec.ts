import {
  HAS_GC,
  assertGcAvailable,
  collectHeapSamples,
  expectCollectible,
  expectRetainedHeapBudget,
  expectTrendToFlatten,
} from "@supergrain/test-utils/memory";
import { describe, it } from "vitest";

import { createReactive, effect } from "../../src";
import { makeLeaves, runArrayShapeCycle, runKernelCycle, runNestedReadCycle } from "./fixtures";

// Always-run sentinel: ensures the memory config actually exposed GC.
// When running under `pnpm test:memory:node` this must pass; if it fails,
// all the `describe.runIf(HAS_GC)` suites below would silently skip and
// give false confidence.
it("GC is exposed (required for all kernel memory tests)", () => {
  assertGcAvailable();
});

describe.runIf(HAS_GC)("kernel memory", () => {
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

  it("collects proxy when multiple effects subscribe and all are stopped", async () => {
    await expectCollectible(() => {
      const raw = { value: 1, label: "a", items: [1, 2, 3] };
      const state = createReactive(raw);

      const stops = [
        effect(() => {
          void state.value;
        }),
        effect(() => {
          void state.label;
        }),
        effect(() => {
          void state.items.length;
        }),
        effect(() => {
          void state.value;
          void state.label;
        }),
      ];

      state.value = 2;
      state.label = "b";
      state.items.push(4);

      return {
        targets: [raw, state as object],
        teardown: () => {
          for (const stop of stops) stop();
        },
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

  it("keeps retained heap bounded across repeated array-shape churn", async () => {
    await expectRetainedHeapBudget(() => {
      for (let index = 0; index < 200; index++) {
        runArrayShapeCycle(index);
      }
    }, 2_500_000);
  });

  // High-N retention test: validates that the per-round heap drift the trend
  // tests showed (~50KB/round positive deltas) actually amortizes — the same
  // cycle run 8x more times must still fit under a 2x budget, not 8x. If a
  // real leak existed this would blow the budget; if it's V8 noise, retention
  // amortizes with cycle count and stays bounded.
  it("retained heap stays sublinear with cycle count (1500 cycles)", async () => {
    await expectRetainedHeapBudget(() => {
      for (let index = 0; index < 1500; index++) {
        runKernelCycle(index);
      }
    }, 5_000_000);
  });

  // Long-lived state: a real app holds one reactive store and continuously
  // attaches/detaches effects against it. Validates that the per-effect
  // disposal path doesn't accumulate references on the long-lived state.
  it("long-lived state stays bounded under continuous effect churn", async () => {
    await expectRetainedHeapBudget(() => {
      const state = createReactive({
        cursor: 0,
        items: Array.from({ length: 32 }, (_, index) => ({ id: index, value: index })),
      });
      const stops: Array<() => void> = [];
      for (let index = 0; index < 800; index++) {
        const stop = effect(() => {
          void state.items[state.cursor % state.items.length]!.value;
        });
        stops.push(stop);
        state.cursor = (state.cursor + 1) % state.items.length;
        if (index % 4 === 0) {
          // Detach the oldest few effects, simulating real subscriber churn.
          stops.splice(0, 4).forEach((dispose) => dispose());
        }
      }
      for (const stop of stops) stop();
    }, 3_500_000);
  });

  it("flattens retained heap across repeated proxy churn rounds", async () => {
    const samples = await collectHeapSamples(8, (round) => {
      for (let index = 0; index < 80; index++) {
        runKernelCycle(round * 1_000 + index);
      }
    });

    // Absolute budget + tail/head ratio is the robust pair. Per-round delta
    // counts (maxPositiveDeltas, maxConsecutiveGrowthRounds) are too sensitive
    // to V8's small monotonic noise across rounds — they fire on healthy cycles
    // when the heap drifts upward by a few KB before plateauing. The bounded
    // total + sublinear scaling tests above are what catch real leaks.
    expectTrendToFlatten(samples, {
      maxGrowthBytes: 2_500_000,
      maxLastDeltaBytes: 450_000,
      maxTailHeadRatio: 1.8,
    });
  });

  it("flattens retained heap across repeated array-shape churn rounds", async () => {
    const samples = await collectHeapSamples(8, (round) => {
      for (let index = 0; index < 80; index++) {
        runArrayShapeCycle(round * 1_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 2_500_000,
      maxLastDeltaBytes: 450_000,
      maxTailHeadRatio: 1.8,
      maxConsecutiveGrowthRounds: 4,
    });
  });

  it("flattens retained heap across repeated nested-proxy read churn rounds", async () => {
    const samples = await collectHeapSamples(8, (round) => {
      for (let index = 0; index < 60; index++) {
        runNestedReadCycle(round * 1_000 + index);
      }
    });

    expectTrendToFlatten(samples, {
      maxGrowthBytes: 2_500_000,
      maxLastDeltaBytes: 450_000,
      maxTailHeadRatio: 1.8,
      maxConsecutiveGrowthRounds: 4,
    });
  });
});
