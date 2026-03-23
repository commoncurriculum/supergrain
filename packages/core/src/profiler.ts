/**
 * Lightweight profiler for diagnosing signal subscription and render behavior.
 *
 * Zero cost when disabled — all instrumentation checks a single boolean flag.
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

export interface Profile {
  /** Signal reads that created a subscription (inside a tracked effect) */
  signalReads: number;
  /** Signal reads that skipped subscription (no active subscriber) */
  signalSkips: number;
  /** Signal writes (property changes that notified subscribers) */
  signalWrites: number;
  /** Effect fires (each = one component re-render via tracked()) */
  effectFires: number;
}

let _enabled = false;
let _signalReads = 0;
let _signalSkips = 0;
let _signalWrites = 0;
let _effectFires = 0;

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
}

export function getProfile(): Profile {
  return {
    signalReads: _signalReads,
    signalSkips: _signalSkips,
    signalWrites: _signalWrites,
    effectFires: _effectFires,
  };
}

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
 * Wrapped effect that counts re-runs (not the initial run) when profiling is enabled.
 */
export function profiledEffect(fn: () => void): () => void {
  let firstRun = true;
  return alienEffect(() => {
    if (firstRun) {
      firstRun = false;
      fn();
      return;
    }
    profileEffectFire();
    fn();
  });
}
