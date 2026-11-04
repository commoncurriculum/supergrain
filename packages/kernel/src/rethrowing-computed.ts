import { computed } from "alien-signals";

/** A throw cached as a value: a new one each time, so a new throw notifies. */
class Failure {
  constructor(readonly error: unknown) {}
}

/** A value, or a cached throw: what a {@link catchingComputed} returns. */
export type Caught<V> = V | Failure;

/**
 * A plain `computed` that caches a throw as a value instead of letting it
 * escape. Read it with {@link settle}, which rethrows. Cheaper than
 * {@link rethrowingComputed} when there are many, as there is no wrapper
 * function per computed.
 *
 * As with `computed`, returning the previous value (passed to the getter)
 * doesn't notify subscribers.
 */
export function catchingComputed<V>(getter: (previous: V | undefined) => V): () => Caught<V> {
  return computed((previous?: Caught<V>) => {
    try {
      return getter(previous instanceof Failure ? undefined : previous);
    } catch (error) {
      return new Failure(error);
    }
  });
}

/** Read a {@link catchingComputed}: its value, or its cached throw rethrown. */
export function settle<V>(read: () => Caught<V>): V {
  const result = read();
  if (result instanceof Failure) throw result.error;
  return result;
}

/**
 * A `computed` that caches a throw the way it caches a value: every read
 * rethrows the error until one of the getter's dependencies changes.
 *
 * A plain alien-signals `computed` whose getter throws keeps its previous
 * value, so the read after the throw quietly returns stale data.
 */
export function rethrowingComputed<V>(getter: (previous: V | undefined) => V): () => V {
  const read = catchingComputed(getter);
  // `settle` inlined: calling it here costs a measurable share of every read.
  return () => {
    const result = read();
    if (result instanceof Failure) throw result.error;
    return result;
  };
}
