/**
 * Lightweight profiler for diagnosing signal subscription and render behavior.
 *
 * Zero cost when disabled — profiling functions are swapped to empty no-ops
 * that V8 inlines away. No boolean checks on the hot path.
 * Enable with `enableProfiling()`, read with `getProfile()`, reset with `resetProfiler()`.
 *
 * @example
 * ```ts
 * enableProfiling();
 * resetProfiler();
 * update();
 * const p = getProfile();
 * expect(p.effectFires).toBe(100); // 100 rows re-rendered
 * disableProfiling();
 * ```
 */

import { effect as alienEffect } from "alien-signals";

/** Named timing buckets for profiling where time is spent. */
export type TimingBucket =
  | "trackedSetup"
  | "computedSetup"
  | "forRender"
  | "forSwapEffect"
  | "forArrayCopy"
  | "signalSubscribe";

export interface Profile {
  /** Signal reads that created a subscription (inside a tracked effect) */
  signalReads: number;
  /** Signal reads that skipped subscription (no active subscriber) */
  signalSkips: number;
  /** Signal writes (property changes that notified subscribers) */
  signalWrites: number;
  /** Effect fires (each = one component re-render via tracked()) */
  effectFires: number;
  /** Accumulated time (ms) per named timing bucket */
  timings: Record<TimingBucket, number>;
}

let _signalReads = 0;
let _signalSkips = 0;
let _signalWrites = 0;
let _effectFires = 0;

const _timings: Record<TimingBucket, number> = {
  trackedSetup: 0,
  computedSetup: 0,
  forRender: 0,
  forSwapEffect: 0,
  forArrayCopy: 0,
  signalSubscribe: 0,
};

const _timingStarts: Record<string, number> = {};

// eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional no-op for zero-cost disabled state
function noop(): void {}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional no-op signature
function noopBucket(_bucket: TimingBucket): void {}

function countSignalRead(): void {
  _signalReads++;
}
function countSignalSkip(): void {
  _signalSkips++;
}
function countSignalWrite(): void {
  _signalWrites++;
}
function countEffectFire(): void {
  _effectFires++;
}
function startTiming(bucket: TimingBucket): void {
  _timingStarts[bucket] = performance.now();
}
function endTiming(bucket: TimingBucket): void {
  const start = _timingStarts[bucket];
  if (start !== undefined) {
    _timings[bucket] += performance.now() - start;
  }
}

// Exported as mutable bindings — swapped between no-ops and counters
export let profileSignalRead: () => void = noop;
export let profileSignalSkip: () => void = noop;
export let profileSignalWrite: () => void = noop;
export let profileEffectFire: () => void = noop;
export let profileTimeStart: (bucket: TimingBucket) => void = noopBucket;
export let profileTimeEnd: (bucket: TimingBucket) => void = noopBucket;

export function enableProfiling(): void {
  profileSignalRead = countSignalRead;
  profileSignalSkip = countSignalSkip;
  profileSignalWrite = countSignalWrite;
  profileEffectFire = countEffectFire;
  profileTimeStart = startTiming;
  profileTimeEnd = endTiming;
}

export function disableProfiling(): void {
  profileSignalRead = noop;
  profileSignalSkip = noop;
  profileSignalWrite = noop;
  profileEffectFire = noop;
  profileTimeStart = noopBucket;
  profileTimeEnd = noopBucket;
}

export function resetProfiler(): void {
  _signalReads = 0;
  _signalSkips = 0;
  _signalWrites = 0;
  _effectFires = 0;
  for (const key of Object.keys(_timings) as TimingBucket[]) {
    _timings[key] = 0;
  }
}

export function getProfile(): Profile {
  return {
    signalReads: _signalReads,
    signalSkips: _signalSkips,
    signalWrites: _signalWrites,
    effectFires: _effectFires,
    timings: { ..._timings },
  };
}

/**
 * Wrapped effect that counts re-runs (not the initial run) when profiling is enabled.
 * Forwards return values to preserve cleanup semantics.
 */
export function profiledEffect<T>(fn: () => T): () => void {
  let firstRun = true;
  return alienEffect(() => {
    if (firstRun) {
      firstRun = false;
      return fn();
    }
    profileEffectFire();
    return fn();
  });
}
