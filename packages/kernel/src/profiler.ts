// Disabled hooks are empty functions V8 inlines away, so the hot path has no
// flag check.

export interface Profile {
  /** Signal reads that created a subscription (inside a tracked effect) */
  signalReads: number;
  /** Signal reads that skipped subscription (no active subscriber) */
  signalSkips: number;
  /** Signal writes (property changes that notified subscribers) */
  signalWrites: number;
}

let _signalReads = 0;
let _signalSkips = 0;
let _signalWrites = 0;

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

export let profileSignalRead: () => void = noop;
export let profileSignalSkip: () => void = noop;
export let profileSignalWrite: () => void = noop;

export function enableProfiling(): void {
  profileSignalRead = countSignalRead;
  profileSignalSkip = countSignalSkip;
  profileSignalWrite = countSignalWrite;
}

export function disableProfiling(): void {
  profileSignalRead = noop;
  profileSignalSkip = noop;
  profileSignalWrite = noop;
}

export function resetProfiler(): void {
  _signalReads = 0;
  _signalSkips = 0;
  _signalWrites = 0;
}

export function getProfile(): Profile {
  return {
    signalReads: _signalReads,
    signalSkips: _signalSkips,
    signalWrites: _signalWrites,
  };
}
