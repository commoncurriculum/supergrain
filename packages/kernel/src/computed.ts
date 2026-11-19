import { computed as alienComputed } from "alien-signals";

import { noteRead } from "./render-reads";

/**
 * A derived value, recomputed lazily when a signal it read changes.
 *
 * A thin wrapper over alien-signals' `computed`: a read from a `tracked`
 * render is noted, so the render's effect can read it again when it fires.
 * Without that, an unrelated re-render (one of the component's other reads
 * changed) would leave the computed with no subscriber, drop its cached
 * value, and run its getter again.
 */
export function computed<T>(getter: (previous?: T) => T): () => T {
  const read = alienComputed(getter);
  return () => {
    noteRead(read);
    return read();
  };
}
