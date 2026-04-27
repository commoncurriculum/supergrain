import { expect } from "vitest";

const runtime = globalThis as typeof globalThis & {
  gc?: () => void;
  process?: {
    memoryUsage?: () => { heapUsed: number };
  };
};

function getGc(): (() => void) | undefined {
  if (typeof runtime.gc === "function") return runtime.gc;
  try {
    return (0, eval)("gc") as (() => void) | undefined;
  } catch {
    return undefined;
  }
}

export const HAS_GC =
  typeof getGc() === "function" && typeof runtime.process?.memoryUsage === "function";

/**
 * Always-run sentinel for memory configs. When `pnpm test:memory:node` is used
 * this catches mis-configuration that would otherwise silently skip every
 * leak check (every `describe.runIf(HAS_GC)` block evaluates to false).
 */
export function assertGcAvailable(): void {
  if (!HAS_GC) {
    throw new Error(
      "Memory tests require GC exposure. Run via: pnpm test:memory:node  " +
        "(which passes --expose-gc to the worker process). " +
        "Without it every memory test skips and no leak is caught.",
    );
  }
}

export function requireGc(): void {
  if (typeof getGc() !== "function") {
    throw new TypeError("Memory tests require node --expose-gc.");
  }
  if (typeof runtime.process?.memoryUsage !== "function") {
    throw new TypeError("Memory tests require process.memoryUsage().");
  }
}

export async function delay(ms = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function forceGc(cycles = 6): Promise<void> {
  requireGc();
  const gc = getGc()!;
  for (let index = 0; index < cycles; index++) {
    gc();
    await Promise.resolve();
    await delay();
  }
}

export async function heapUsedAfterGc(): Promise<number> {
  await forceGc();
  return runtime.process!.memoryUsage!().heapUsed;
}

export async function expectRetainedHeapBudget(
  run: () => void | Promise<void>,
  maxGrowthBytes: number,
): Promise<void> {
  const before = await heapUsedAfterGc();
  await run();
  const after = await heapUsedAfterGc();
  expect(after - before).toBeLessThanOrEqual(maxGrowthBytes);
}

export async function collectHeapSamples(
  rounds: number,
  runRound: (round: number) => void | Promise<void>,
): Promise<Array<number>> {
  const samples: Array<number> = [];
  for (let round = 0; round < rounds; round++) {
    await runRound(round);
    samples.push(await heapUsedAfterGc());
  }
  return samples;
}

export interface TrendOptions {
  /** Total heap growth from first to last sample. */
  maxGrowthBytes: number;
  /** Heap delta of the final round. Catches a leak still in progress. */
  maxLastDeltaBytes: number;
  /**
   * Maximum number of rounds with positive heap growth. Optional because V8
   * frequently shows small positive deltas across most rounds even with no
   * leak (JIT, lazy weak-map cleanup, etc.). When absolute and structural
   * signals are present this metric just adds flakiness.
   */
  maxPositiveDeltas?: number;
  /**
   * Maximum ratio of (mean of last two samples) to (mean of first two samples).
   * Catches slow-but-steady growth that stays under maxGrowthBytes. Requires at
   * least 4 samples.
   */
  maxTailHeadRatio?: number;
  /**
   * Maximum number of consecutive rounds with positive heap growth. Catches an
   * unbroken upward slope even when individual deltas are small.
   */
  maxConsecutiveGrowthRounds?: number;
}

export function expectTrendToFlatten(samples: ReadonlyArray<number>, options: TrendOptions): void {
  expect(samples.length).toBeGreaterThanOrEqual(2);
  const deltas = samples.slice(1).map((sample, index) => sample - samples[index]!);
  const totalGrowth = samples.at(-1)! - samples[0]!;
  const lastDelta = deltas.at(-1) ?? 0;

  expect(totalGrowth, "total heap growth exceeded budget").toBeLessThanOrEqual(
    options.maxGrowthBytes,
  );
  expect(lastDelta, "last-round heap delta exceeded budget").toBeLessThanOrEqual(
    options.maxLastDeltaBytes,
  );

  if (options.maxPositiveDeltas !== undefined) {
    const positiveDeltas = deltas.filter((delta) => delta > 0).length;
    expect(positiveDeltas, "too many rounds with positive heap growth").toBeLessThanOrEqual(
      options.maxPositiveDeltas,
    );
  }

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

  if (options.maxConsecutiveGrowthRounds !== undefined) {
    let consecutive = 0;
    let maxConsecutive = 0;
    for (const delta of deltas) {
      if (delta > 0) {
        consecutive++;
        if (consecutive > maxConsecutive) maxConsecutive = consecutive;
      } else {
        consecutive = 0;
      }
    }
    expect(
      maxConsecutive,
      "consecutive rounds of heap growth indicate a sustained leak",
    ).toBeLessThanOrEqual(options.maxConsecutiveGrowthRounds);
  }
}

export async function expectCollectible(
  factory: () =>
    | {
        targets: Array<object>;
        teardown?: () => void | Promise<void>;
        settle?: () => void | Promise<void>;
      }
    | Promise<{
        targets: Array<object>;
        teardown?: () => void | Promise<void>;
        settle?: () => void | Promise<void>;
      }>,
): Promise<void> {
  let finalized = 0;
  const registry = new FinalizationRegistry<number>(() => {
    finalized++;
  });

  // V8 retains every variable ever live in an async function across every
  // await suspension point. If targets/teardown/settle were held in the same
  // frame as the GC polling loop, they would still be reachable from the
  // suspended frame and could not be collected. The nested IIFE gives them
  // their own frame that is fully released before the loop runs.
  const refs = await (async () => {
    const { targets, teardown, settle } = await factory();
    const weakRefs = targets.map((target, index) => {
      registry.register(target, index);
      return new WeakRef(target);
    });
    await teardown?.();
    await settle?.();
    return weakRefs;
  })();

  for (let attempt = 0; attempt < 60; attempt++) {
    await forceGc();
    if (finalized >= refs.length || refs.every((ref) => ref.deref() === undefined)) {
      break;
    }
    await delay(10);
  }

  const survivingIndices = refs
    .map((ref, index) => ({ index, alive: ref.deref() !== undefined }))
    .filter((entry) => entry.alive)
    .map((entry) => entry.index);

  expect(
    survivingIndices,
    `Targets at indices [${survivingIndices.join(", ")}] were not garbage collected after 60 GC attempts`,
  ).toEqual([]);
}
