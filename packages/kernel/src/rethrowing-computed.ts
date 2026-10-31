import { computed } from "alien-signals";

type Settled<V> = { readonly value: V } | { readonly error: unknown };

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
  const settled = computed((previous?: Settled<V>): Settled<V> => {
    const previousValue = previous && "value" in previous ? previous.value : undefined;
    try {
      const value = getter(previousValue);
      return previous && "value" in previous && previous.value === value ? previous : { value };
    } catch (error) {
      return { error };
    }
  });
  return () => {
    const result = settled();
    if ("error" in result) throw result.error;
    return result.value;
  };
}
