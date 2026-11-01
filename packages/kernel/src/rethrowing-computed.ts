import { computed } from "alien-signals";

/**
 * A `computed` that caches a throw the way it caches a value: every read
 * rethrows the error until one of the getter's dependencies changes.
 *
 * A plain alien-signals `computed` whose getter throws keeps its previous
 * value, so the read after the throw quietly returns stale data.
 *
 * As with `computed`, returning the previous value (passed to the getter)
 * doesn't notify subscribers.
 */
export function rethrowingComputed<V>(getter: (previous: V | undefined) => V): () => V {
  // The latest throw, boxed: a new box each time, so a new throw notifies.
  // A value is cached as itself, with no wrapper to allocate.
  let failure: { readonly error: unknown } | undefined = undefined;
  const settled = computed((previous?: V | { readonly error: unknown }) => {
    try {
      return getter(previous === failure ? undefined : (previous as V | undefined));
    } catch (error) {
      failure = { error };
      return failure;
    }
  });
  return () => {
    const result = settled();
    if (result === failure && failure !== undefined) throw failure.error;
    return result as V;
  };
}
