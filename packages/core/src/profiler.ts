/**
 * Lightweight profiler for diagnosing signal subscription and render behavior.
 *
 * When disabled, profiling adds only a single, predictable boolean check per call,
 * which V8 can efficiently branch-predict as false. The functions themselves are
 * constant (not swapped via mutable let bindings) so V8 can inline them.
 *
 * Enable with `enableProfiling()`, read with `getProfile()`, reset with `resetProfiler()`.
 */

import { effect as alienEffect } from "alien-signals";

/** Named timing buckets for profiling where time is spent. */
export type TimingBucket =
  | "trackedSetup"
  | "trackedHookTime"
  | "trackedEffectTime"
  | "trackedRenderTime"
  | "effectCleanupTime"
  | "computedSetup"
  | "computedAlloc"
  | "computedEval"
  | "forRender"
  | "forSlotBuildTime"
  | "forSwapEffect"
  | "forArrayCopy"
  | "signalSubscribe"
  | "proxyGetTime"
  | "wrapTime"
  | "setPropertyTime"
  | "signalBumpTime"
  | "arrayMutatorTime";

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

let _enabled = false;
let _signalReads = 0;
let _signalSkips = 0;
let _signalWrites = 0;
let _effectFires = 0;

const _timings: Record<TimingBucket, number> = {
  trackedSetup: 0,
  trackedHookTime: 0,
  trackedEffectTime: 0,
  trackedRenderTime: 0,
  effectCleanupTime: 0,
  computedSetup: 0,
  computedAlloc: 0,
  computedEval: 0,
  forRender: 0,
  forSlotBuildTime: 0,
  forSwapEffect: 0,
  forArrayCopy: 0,
  signalSubscribe: 0,
  proxyGetTime: 0,
  wrapTime: 0,
  setPropertyTime: 0,
  signalBumpTime: 0,
  arrayMutatorTime: 0,
};

const _timingStarts: Record<string, number> = {};

export function profileSignalRead(): void {
  if (_enabled) _signalReads++;
}
export function profileSignalSkip(): void {
  if (_enabled) _signalSkips++;
}
export function profileSignalWrite(): void {
  if (_enabled) _signalWrites++;
}
export function profileEffectFire(): void {
  if (_enabled) _effectFires++;
}
/**
 * Start timing a named bucket. Not reentrant — nested calls to the same
 * bucket (e.g., nested For components) will overwrite the outer start time.
 */
export function profileTimeStart(bucket: TimingBucket): void {
  if (_enabled) _timingStarts[bucket] = performance.now();
}
export function profileTimeEnd(bucket: TimingBucket): void {
  if (!_enabled) return;
  const start = _timingStarts[bucket];
  if (start !== undefined) {
    _timings[bucket] += performance.now() - start;
    delete _timingStarts[bucket];
  }
}

export function enableProfiling(): void {
  _enabled = true;
}

export function disableProfiling(): void {
  _enabled = false;
}

export function resetProfiler(): void {
  _signalReads = 0;
  _signalSkips = 0;
  _signalWrites = 0;
  _effectFires = 0;
  for (const key of Object.keys(_timings) as TimingBucket[]) {
    _timings[key] = 0;
  }
  for (const key of Object.keys(_timingStarts)) {
    delete _timingStarts[key];
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
