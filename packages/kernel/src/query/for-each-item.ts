/**
 * Call `fn` with each item of `source`. A kernel array's `forEach` subscribes
 * to its structure with three signals; `for...of` would subscribe to every
 * index.
 */
export function forEachItem<T>(source: Iterable<T>, fn: (item: T) => void): void {
  if (Array.isArray(source)) {
    (source as ReadonlyArray<T>).forEach((item) => fn(item));
  } else {
    for (const item of source) fn(item);
  }
}
