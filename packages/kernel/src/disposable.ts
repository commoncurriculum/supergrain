// Checked under the consumer's TS `lib` (we ship .ts as types), which may not
// declare Symbol.dispose: collapse to `{}` instead of failing to compile.
type DisposeSymbol = SymbolConstructor extends { readonly dispose: infer S extends symbol }
  ? S
  : never;

/**
 * The TC39 `Disposable` protocol, for `using` declarations. Resolves to `{}`
 * when your TypeScript `lib` doesn't declare `Symbol.dispose`.
 */
export type SymbolDisposable = { readonly [K in DisposeSymbol]: () => void };

/**
 * A stop function that is also `Disposable`: call it directly, or bind it
 * with `using` to stop at the end of the enclosing block.
 */
export type Disposer = (() => void) & SymbolDisposable;

// Symbol.dispose is looked up per call so a polyfill installed later still takes.
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
    // Frozen target: no `using` support, but the disposer still works.
  }
  return target as T & SymbolDisposable;
}

let disposerPrototype: object | null = null;

// A shared prototype, not an own property: an own property costs each
// function its own property store (~45 bytes in V8).
export function toDisposer(stop: () => void): Disposer {
  const key = (Symbol as { dispose?: symbol }).dispose;
  /* c8 ignore start -- every runtime the suite runs on (Node 22, Chromium) defines Symbol.dispose */
  if (typeof key !== "symbol") return stop as Disposer;
  /* c8 ignore stop */
  disposerPrototype ??= Object.create(Function.prototype, {
    [key]: {
      value(this: () => void) {
        this();
      },
      configurable: true,
      writable: true,
    },
  }) as object;
  return Object.setPrototypeOf(stop, disposerPrototype) as Disposer;
}
