import { getActiveSub } from "alien-signals";

/**
 * Where a render notes the derived values it reads: the node it tracks into,
 * and the reads so far. `tracked` keeps one per component.
 */
export interface RenderReads {
  /** The node the render tracks into. A read under another node isn't noted. */
  node: unknown;
  readonly reads: Array<() => unknown>;
}

let current: RenderReads | undefined = undefined; // eslint-disable-line unicorn/no-useless-undefined -- init-declarations wants a value

/**
 * Note the render reads into `log` from now on (or none, for `undefined`).
 * Returns the one noted before, to put back.
 */
export function noteReadsIn(log: RenderReads | undefined): RenderReads | undefined {
  const outer = current;
  current = log;
  return outer;
}

/**
 * Note that the render in progress read `read`, a derived value the kernel
 * made (a `useComputed` or `computedList`), so `tracked`
 * can read it again when the render's effect fires.
 *
 * Why: an effect drops the dependencies its run didn't read, and a computed
 * left without subscribers drops its cached state. Reading these again in
 * that run keeps them subscribed until the re-render takes over, so it
 * doesn't rebuild them from scratch. A read inside another computed isn't
 * noted: that computed holds it.
 */
export function noteRead(read: () => unknown): void {
  if (current === undefined || getActiveSub() !== current.node) return;
  const { reads } = current;
  // A render often reads the same value twice in a row.
  if (reads.at(-1) !== read) reads.push(read);
}
