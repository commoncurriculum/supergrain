import { computed as alienComputed } from "alien-signals";

import { noteRead } from "./render-reads";

/** A derived value, recomputed lazily when a signal it read changes. */
export function computed<T>(getter: (previous?: T) => T): () => T {
  const read = alienComputed(getter);
  // alien-signals drops a computed's cache when it loses its last subscriber;
  // noting the read lets a tracked render's effect keep it subscribed.
  return () => {
    noteRead(read);
    return read();
  };
}
