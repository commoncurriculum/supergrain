import { getActiveSub } from "alien-signals";

type Read = () => unknown;

/**
 * What a component's shown render read, so its effect can read it all again
 * when it fires. `tracked` keeps one per component.
 *
 * Why: an effect drops every dependency its run didn't read, and a computed
 * left without subscribers drops its cached state. Reading them again in
 * that run keeps them subscribed until the re-render takes over, so a
 * computed isn't rebuilt from scratch, and a re-render that suspends (and
 * so never shows) leaves the shown render's subscriptions in place.
 */
export class RenderReads {
  /** The node the render in progress tracks into. A read under another node isn't noted. */
  node: ReturnType<typeof getActiveSub> = undefined;
  /** The shown render's reads: the first `count` entries. Reused, never emptied. */
  reads: Array<Read | undefined> = [];
  count = 0;
  /** Where the render in progress starts in `pending`. */
  from = 0;

  /** Read what the shown render read, tracked by the running effect. */
  readAgain(): void {
    const { reads, count } = this;
    for (let i = 0; i < count; i++) {
      try {
        reads[i]!();
      } catch {
        // The re-render reads it again, and throws there.
      }
    }
  }
}

/**
 * The reads of the renders in progress, shared by all components: a render
 * fills it from its `from`, and gives that part back when it ends. A render
 * that never shows mustn't touch its component's shown reads, so it can't
 * write there directly; one shared list means a component holds one list.
 */
const pending: Array<Read | undefined> = [];
let end = 0;
let current: RenderReads | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value

/** A render starts: note its reads into `log`. Returns the log noted before, to pass to `endReads`. */
export function startReads(log: RenderReads): RenderReads | undefined {
  const outer = current;
  log.from = end;
  current = log;
  return outer;
}

/**
 * The render ended. If it `shows`, its reads become the shown ones. Clears
 * what it used, so nothing keeps a read alive that no render holds.
 */
export function endReads(log: RenderReads, outer: RenderReads | undefined, shows: boolean): void {
  const { from } = log;
  const count = end - from;
  // Sized to fit when it must grow: growing by push leaves room for 16 more.
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

/**
 * Note that the render in progress read `read`: a store signal or a derived
 * value the kernel made (a `computed` or `computedList`). A read inside
 * another computed isn't noted: that computed holds it.
 */
export function noteRead(read: Read): void {
  const log = current;
  if (log === undefined || getActiveSub() !== log.node) return;
  // A render often reads the same value twice in a row.
  if (end > log.from && pending[end - 1] === read) return;
  pending[end++] = read;
}

/** Read a store signal, tracked, noting it for the `tracked` render in progress. */
export function readSignal<T>(signal: () => T): T {
  if (current !== undefined) noteRead(signal);
  return signal();
}
