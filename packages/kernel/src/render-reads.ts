import { getActiveSub } from "alien-signals";

type Read = () => unknown;

const NO_READS: Array<Read | undefined> = [];

// alien-signals drops every dependency an effect run didn't read, and a
// computed left without subscribers drops its cache. Re-reading the shown
// render's reads in the effect keeps them, including across a suspended render.
export class RenderReads {
  node: ReturnType<typeof getActiveSub> = undefined;
  // Starts as the shared NO_READS, which must never be written to.
  reads: Array<Read | undefined> = NO_READS;
  count = 0;
  from = 0;

  readAgain(): void {
    const { reads, count } = this;
    for (let i = 0; i < count; i++) {
      try {
        reads[i]!();
      } catch {
        // The re-render reads it again and throws there.
      }
    }
  }
}

// A render that never shows (suspends) must not touch its component's shown
// reads, so renders in progress write here.
const pending: Array<Read | undefined> = [];
let end = 0;
let current: RenderReads | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value

export function startReads(log: RenderReads): RenderReads | undefined {
  const outer = current;
  log.from = end;
  current = log;
  return outer;
}

export function endReads(log: RenderReads, outer: RenderReads | undefined, shows: boolean): void {
  const { from } = log;
  const count = end - from;
  // Exact size: growing by push over-allocates by ~16 slots.
  // eslint-disable-next-line unicorn/no-new-array -- a fixed size is the point
  if (shows && log.reads.length < count) log.reads = new Array<Read | undefined>(count);
  const { reads } = log;
  for (let i = 0; i < count; i++) {
    if (shows) reads[i] = pending[from + i];
    pending[from + i] = undefined;
  }
  if (shows) {
    for (let i = count; i < log.count; i++) reads[i] = undefined;
    log.count = count;
  }
  end = from;
  current = outer;
}

export function noteRead(read: Read): void {
  const log = current;
  if (log === undefined || getActiveSub() !== log.node) return;
  if (end > log.from && pending[end - 1] === read) return;
  pending[end++] = read;
}

export function readSignal<T>(signal: () => T): T {
  if (current !== undefined) noteRead(signal);
  return signal();
}
