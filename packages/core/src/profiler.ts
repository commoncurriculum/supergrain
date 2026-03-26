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

let _signalReads = 0;
let _signalSkips = 0;
let _signalWrites = 0;
let _effectFires = 0;

// eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional no-op for zero-cost disabled state
function noop(): void {}

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

// Exported as mutable bindings — swapped between no-ops and counters
export let profileSignalRead: () => void = noop;
export let profileSignalSkip: () => void = noop;
export let profileSignalWrite: () => void = noop;
export let profileEffectFire: () => void = noop;

export function enableProfiling(): void {
  profileSignalRead = countSignalRead;
  profileSignalSkip = countSignalSkip;
  profileSignalWrite = countSignalWrite;
  profileEffectFire = countEffectFire;
}

export function disableProfiling(): void {
  profileSignalRead = noop;
  profileSignalSkip = noop;
  profileSignalWrite = noop;
  profileEffectFire = noop;
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
