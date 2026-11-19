import { createReactive, effect, type SymbolDisposable } from "@supergrain/kernel";
import { getActiveSub, makeDisposable, setActiveSub } from "@supergrain/kernel/internal";

/**
 * Context passed to a resource's `setup`. Setup runs on create, reruns on
 * tracked change (cleanup first), and tears down on `dispose` or `using`.
 *
 * Sync setups return their cleanup. Async setups must register cleanup via
 * `ctx.onCleanup(...)`, since a returned function would only resolve the Promise.
 * `abortSignal` aborts on every rerun and on `dispose`.
 */
export interface ResourceContext {
  readonly abortSignal: AbortSignal;
  onCleanup(fn: () => void): void;
}

/**
 * Factory type returned by `defineResource`. If `Args` is `void`, the
 * factory takes no arguments; otherwise it takes an `argsFn` thunk.
 */
export type ResourceFactory<Args, T extends object> = [Args] extends [void]
  ? () => T & SymbolDisposable
  : (argsFn: () => Args) => T & SymbolDisposable;

const disposers = new WeakMap<object, () => void>();

export function registerDisposer<T extends object>(
  target: T,
  fn: () => void,
): T & SymbolDisposable {
  disposers.set(target, fn);
  return makeDisposable(target, () => dispose(target));
}

type SetupResult = void | (() => void) | Promise<void>;

function withUntracked<R>(run: () => R): R {
  const prev = getActiveSub();
  setActiveSub(undefined);
  try {
    return run();
  } finally {
    setActiveSub(prev);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    !!value && typeof value === "object" && typeof (value as { then?: unknown }).then === "function"
  );
}

interface RunSpec<Args, T extends object> {
  state: T;
  getArgs: () => Args;
  invokeSetup: (state: T, args: Args, ctx: ResourceContext) => SetupResult;
  trackSetup: boolean;
}

function runResource<Args, T extends object>(spec: RunSpec<Args, T>): T & SymbolDisposable {
  const { state, getArgs, invokeSetup, trackSetup } = spec;
  let cleanups: Array<() => void> = [];
  let controller: AbortController | undefined = undefined;
  let disposed = false;
  let generation = 0;

  function runCleanups(): void {
    controller?.abort();
    controller = undefined;
    const pending = cleanups;
    cleanups = [];
    for (const fn of pending) {
      try {
        fn();
      } catch (error) {
        console.error("[supergrain/resource] cleanup threw:", error);
      }
    }
  }

  // alien-signals links a new effect to the active subscriber; create it
  // untracked so a resource made inside a render or effect isn't nested.
  const stopEffect = withUntracked(() =>
    effect(() => {
      const gen = ++generation;
      runCleanups();
      controller = new AbortController();

      const args = getArgs();

      const ctx: ResourceContext = {
        abortSignal: controller.signal,
        // If the resource has been disposed (or superseded) by the time
        // this fires — e.g. `dispose()` ran while an async setup was
        // awaiting — run the cleanup immediately instead of pushing it
        // into a list that will never drain. This is the dispose-race
        // safeguard; don't remove without reworking the async contract.
        onCleanup: (fn) => {
          if (gen !== generation || disposed) {
            try {
              fn();
            } catch (error) {
              console.error("[supergrain/resource] late cleanup threw:", error);
            }
            return;
          }
          cleanups.push(fn);
        },
      };

      const result: SetupResult = trackSetup
        ? invokeSetup(state, args, ctx)
        : withUntracked(() => invokeSetup(state, args, ctx));

      if (typeof result === "function") {
        cleanups.push(result);
      } else if (isPromiseLike(result)) {
        // Thenables may lack `.catch`; DOMException isn't global in every runtime.
        Promise.resolve(result).catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          if (gen === generation) {
            console.error("[supergrain/resource] async setup rejected:", error);
          }
        });
      }
    }),
  );

  return registerDisposer(state, () => {
    disposed = true;
    stopEffect();
    runCleanups();
  });
}

/**
 * Inline resource — one-off, reactive reads in `setup` drive reruns.
 *
 * @example
 * ```ts
 * const userId = signal(1);
 * const user = resource(
 *   { data: null as User | null, isLoading: true },
 *   async (state, { abortSignal }) => {
 *     const res = await fetch(`/users/${userId()}`, { signal: abortSignal });
 *     state.data = await res.json();
 *     state.isLoading = false;
 *   },
 * );
 * ```
 */
export function resource<T extends object>(
  initial: T,
  setup: (state: T, ctx: ResourceContext) => SetupResult,
): T & SymbolDisposable {
  return runResource<void, T>({
    // TS can't reduce the Branded<T> conditional type.
    state: createReactive(initial) as T,
    getArgs: (): void => {},
    invokeSetup: (s, _args, ctx) => setup(s, ctx),
    trackSetup: true,
  });
}

/**
 * Define a reusable resource factory. The `initial` argument is a
 * factory (called once per instance) so each consumer gets fresh
 * state. `setup` receives the args produced by the caller's thunk;
 * reactive reads inside the thunk drive reruns, reads inside `setup`
 * do not.
 *
 * @example
 * ```ts
 * const fetchJson = defineResource<string, { data: unknown | null; error: Error | null }>(
 *   () => ({ data: null, error: null }),
 *   async (state, url, { abortSignal }) => {
 *     const res = await fetch(url, { signal: abortSignal });
 *     state.data = await res.json();
 *   },
 * );
 *
 * const store = createReactive({ userId: 1 });
 * const user = fetchJson(() => `/users/${store.userId}`);
 * store.userId = 2; // old fetch aborted, new one starts
 * ```
 */
export function defineResource<Args, T extends object>(
  initial: () => T,
  setup: (state: T, args: Args, ctx: ResourceContext) => SetupResult,
): ResourceFactory<Args, T> {
  function instantiate(argsFn?: () => Args): T & SymbolDisposable {
    return runResource<Args, T>({
      // TS can't reduce the Branded<T> conditional type.
      state: createReactive(initial()) as T,
      // argsFn is absent only when Args is void.
      getArgs: () => (argsFn ? argsFn() : (undefined as unknown as Args)),
      invokeSetup: setup,
      trackSetup: false,
    });
  }
  return instantiate as ResourceFactory<Args, T>;
}

/**
 * Stop a resource permanently: aborts in-flight work, runs cleanups,
 * halts the reactive effect. Idempotent and safe on any object — no-op
 * if not a resource or already disposed. In React, `useResource`
 * disposes automatically on unmount.
 *
 * Resources are also `Disposable`: `using user = reactivePromise(...)`
 * calls this at the end of the enclosing block.
 */
export function dispose(resource: object): void {
  const fn = disposers.get(resource);
  if (!fn) return;
  disposers.delete(resource);
  fn();
}
