import { computed } from "alien-signals";

// A new instance per throw, so a repeated throw still notifies.
class Failure {
  constructor(readonly error: unknown) {}
}

export type Caught<V> = V | Failure;

export function catchingComputed<V>(getter: (previous: V | undefined) => V): () => Caught<V> {
  return computed((previous?: Caught<V>) => {
    try {
      return getter(previous instanceof Failure ? undefined : previous);
    } catch (error) {
      return new Failure(error);
    }
  });
}

export function settle<V>(read: () => Caught<V>): V {
  const result = read();
  if (result instanceof Failure) throw result.error;
  return result;
}

// An alien-signals computed whose getter throws keeps its previous value, so
// the next read would return stale data. This rethrows until a dependency changes.
export function rethrowingComputed<V>(getter: (previous: V | undefined) => V): () => V {
  const read = catchingComputed(getter);
  // `settle` inlined: the call costs a measurable share of every read.
  return () => {
    const result = read();
    if (result instanceof Failure) throw result.error;
    return result;
  };
}
