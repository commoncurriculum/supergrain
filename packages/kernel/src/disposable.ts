// `SymbolConstructor["dispose"]` only exists when the consumer's TypeScript
// `lib` includes `esnext.disposable` (or `@types/node` declares it). Resolve
// to `never` otherwise so `SymbolDisposable` collapses to `{}` instead of
// failing to compile — the package ships `.ts` sources as its types, so this
// file is type-checked under the consumer's `lib`, not ours.
type DisposeSymbol = SymbolConstructor extends { readonly dispose: infer S extends symbol }
  ? S
  : never;

/**
 * The TC39 `Disposable` protocol — `{ [Symbol.dispose](): void }` — so the
 * value works with a `using` declaration. Resolves to `{}` when the
 * TypeScript `lib` in use doesn't declare `Symbol.dispose`.
 */
export type SymbolDisposable = { readonly [K in DisposeSymbol]: () => void };

/**
 * A stop function that is also `Disposable`: call it directly, or bind it
 * with `using` to stop at the end of the enclosing block.
 */
export type Disposer = (() => void) & SymbolDisposable;

/**
 * Attach `dispose` to `target` as its non-enumerable `[Symbol.dispose]`
 * method and return `target` typed as `Disposable`.
 *
 * Runtimes without `Symbol.dispose` (and frozen targets) are left untouched:
 * `using` can't work there anyway, and the disposer is still callable
 * directly. `Symbol.dispose` is looked up per call rather than cached at
 * module load so a polyfill installed after this module evaluates still takes.
 */
export function makeDisposable<T extends object>(
  target: T,
  dispose: () => void,
): T & SymbolDisposable {
  const key = (Symbol as { dispose?: symbol }).dispose;
  /* c8 ignore start -- every runtime the suite runs on (Node 22, Chromium) defines Symbol.dispose */
  if (typeof key !== "symbol") return target as T & SymbolDisposable;
  /* c8 ignore stop */
  try {
    Object.defineProperty(target, key, {
      value: dispose,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen target — e.g. a husk resource built on a frozen `initial` object,
    // which `createReactive` passes through unwrapped. No `using` support
    // there; `dispose(x)` still works.
  }
  return target as T & SymbolDisposable;
}
