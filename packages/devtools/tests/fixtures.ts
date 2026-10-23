/**
 * Define `key` on `target` as a getter that throws `thrown` — the asserting
 * getter `serialize` must degrade to an `unreadable` node. Enumerable by
 * default, so `Object.keys` lists it; pass `enumerable: false` for fields like
 * `Error.cause` that are probed explicitly.
 */
export function defineThrowingGetter<T extends object>(
  target: T,
  key: string,
  thrown: unknown,
  { enumerable = true }: { enumerable?: boolean } = {},
): T {
  Object.defineProperty(target, key, {
    enumerable,
    get() {
      throw thrown;
    },
  });
  return target;
}
