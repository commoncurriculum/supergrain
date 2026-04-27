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

// Always-run sentinel: ensures the memory config actually exposed GC.
// When running under `pnpm test:memory:node` this must pass; if it fails,
// all the `describe.runIf(HAS_GC)` suites below would silently skip and
// give false confidence.
it("GC is exposed (required for all kernel memory tests)", () => {
  assertGcAvailable();
});

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

/**
 * Exercises array mutation methods with varying array shapes to stress
 * the batch/version-signal path used by array mutators.
 */
function runArrayShapeCycle(seed: number): void {
  // Varies array length on each cycle (seed % 12 || 4 gives values 1-11 with
  // 4 as the fallback when seed is a multiple of 12) to exercise different
  // batch/version-signal code paths across both short and longer arrays.
  const state = createReactive({
    items: Array.from({ length: seed % 12 || 4 }, (_, index) => ({
      id: index,
      value: seed + index,
    })),
  });

  let sum = 0;
  const stop = effect(() => {
    sum = state.items.reduce((acc, item) => acc + item.value, 0);
  });

  state.items.push({ id: 999, value: seed });
  state.items.pop();
  state.items.splice(0, 1, { id: -1, value: seed * 2 });
  state.items.sort((a, b) => a.value - b.value);
  state.items.reverse();
  void sum;
  stop();
}

/**
 * Stresses nested-proxy read paths: many deeply nested objects accessed
 * inside an effect that is then discarded.
 */
function runNestedReadCycle(seed: number): void {
  type Nested = { value: number; child?: Nested };

  function makeNested(depth: number, base: number): Nested {
    return depth === 0
      ? { value: base }
      : { value: base + depth, child: makeNested(depth - 1, base) };
  }

  const state = createReactive({
    root: makeNested(6, seed),
    list: Array.from({ length: 10 }, (_, index) => makeNested(3, seed + index)),
  });

  const stop = effect(() => {
    let n: Nested | undefined = state.root;
    while (n) {
      void n.value;
      n = n.child;
    }
    for (const item of state.list) {
      void item.value;
      void item.child?.value;
    }
  });

  // Mutate some nodes to exercise write paths too
  state.root.value = seed + 100;
  if (state.root.child) {
    state.root.child.value = seed + 200;
  }
  stop();
}

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

  it("flattens retained heap across repeated proxy churn rounds", async () => {
    const samples = await collectHeapSamples(8, (round) => {
      for (let index = 0; index < 80; index++) {
        runKernelCycle(round * 1_000 + index);
      }
    });

    // Absolute budget + tail/head ratio is the robust pair. Per-round delta
    // counts (maxPositiveDeltas, maxConsecutiveGrowthRounds) are too sensitive
    // to V8's small monotonic noise across rounds — they fire on healthy cycles
    // when the heap drifts upward by a few KB before plateauing.
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
      maxConsecutiveGrowthRounds: 6,
    });
  });
});
