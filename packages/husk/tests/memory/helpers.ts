import { expect } from "vitest";

const runtime = globalThis as typeof globalThis & {
  gc?: () => void;
  process?: {
    env?: Record<string, string | undefined>;
    memoryUsage?: () => { heapUsed: number };
  };
};

export const RUN_SOAK = runtime.process?.env?.["SUPERGRAIN_MEMORY_SOAK"] === "1";

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
 * Assert that GC is available. Always-run sentinel for the memory config:
 * when the dedicated test:memory:node command is used, this catches any
 * mis-configuration that would otherwise silently skip all meaningful tests.
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
    throw new Error("Memory tests require node --expose-gc.");
  }
  if (typeof runtime.process?.memoryUsage !== "function") {
    throw new Error("Memory tests require process.memoryUsage().");
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

export function expectTrendToFlatten(
  samples: ReadonlyArray<number>,
  options: {
    maxGrowthBytes: number;
    maxPositiveDeltas: number;
    maxLastDeltaBytes: number;
    /**
     * Maximum ratio of (mean of last two samples) to (mean of first two
     * samples). Catches slow-but-steady monotonic leaks that stay below the
     * absolute maxGrowthBytes ceiling. Default: unchecked.
     */
    maxTailHeadRatio?: number;
    /**
     * Maximum number of consecutive rounds with positive heap growth. Catches
     * an unbroken upward slope even when individual deltas are small. Default:
     * unchecked.
     */
    maxConsecutiveGrowthRounds?: number;
  },
): void {
  expect(samples.length).toBeGreaterThanOrEqual(2);
  const deltas = samples.slice(1).map((sample, index) => sample - samples[index]!);
  const totalGrowth = samples.at(-1)! - samples[0]!;
  const positiveDeltas = deltas.filter((delta) => delta > 0).length;
  const lastDelta = deltas.at(-1) ?? 0;

  expect(totalGrowth, "total heap growth exceeded budget").toBeLessThanOrEqual(
    options.maxGrowthBytes,
  );
  expect(positiveDeltas, "too many rounds with positive heap growth").toBeLessThanOrEqual(
    options.maxPositiveDeltas,
  );
  expect(lastDelta, "last-round heap delta exceeded budget").toBeLessThanOrEqual(
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
  let refs: Array<WeakRef<object>> = [];
  let finalized = 0;
  const registry = new FinalizationRegistry<number>(() => {
    finalized++;
  });

  {
    const { targets, teardown, settle } = await factory();
    refs = targets.map((target, index) => {
      registry.register(target, index);
      return new WeakRef(target);
    });
    await teardown?.();
    await settle?.();
  }

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
