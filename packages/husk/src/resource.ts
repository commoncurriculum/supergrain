import { createReactive } from "@supergrain/kernel";
import { getCurrentSub, setCurrentSub } from "@supergrain/kernel/internal";
import { effect } from "alien-signals";

/**
 * A resource is a reactive function with cleanup logic — one of two
 * shapes, depending on how you instantiate it.
 *
 * - `resource(initial, setup)` — inline, one-off. Reactive reads inside
 *   `setup` drive reruns. Simplest shape; use when the work IS the
 *   reactive read (async fetches with tracked inputs, subscriptions).
 *
 * - `defineResource(initialFactory, setup)` — returns a reusable
 *   factory. Callers pass an `argsFn` thunk; the thunk's reactive reads
 *   drive reruns, `setup` reads are NOT tracked. Use when you want a
 *   primitive with a clear "what triggers reruns" surface at call
 *   sites.
 *
 * Both share the same lifecycle contract: setup runs on create, reruns
 * on tracked change (with cleanup first), and tears down on `dispose`.
 *
 * Sync setups return cleanup (`return () => teardown()`). Async setups
 * register via `ctx.onCleanup(...)` — `return` would resolve a Promise.
 * `ctx.abortSignal` trips on every rerun and on `dispose`.
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
  ? () => T
  : (argsFn: () => Args) => T;

const disposers = new WeakMap<object, () => void>();

export function registerDisposer(target: object, fn: () => void): void {
  disposers.set(target, fn);
}

type SetupResult = void | (() => void) | Promise<void>;

function withUntracked<R>(run: () => R): R {
  const prev = getCurrentSub();
  setCurrentSub(undefined);
  try {
    return run();
  } finally {
    setCurrentSub(prev);
  }
}

interface RunSpec<Args, T extends object> {
  state: T;
  getArgs: () => Args;
  invokeSetup: (state: T, args: Args, ctx: ResourceContext) => SetupResult;
  trackSetup: boolean;
}

function runResource<Args, T extends object>(spec: RunSpec<Args, T>): T {
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

  // Create the effect outside any ambient subscriber. alien-signals' `effect`
  // links the new effect as a dep of `activeSub` when one exists — so without
  // this, a resource created inside a `tracked()` render (or another effect)
  // becomes nested and doesn't propagate its own deps independently.
  const stopEffect = withUntracked(() =>
    effect(() => {
      /* c8 ignore start -- stopEffect prevents disposed resources from being re-entered */
      if (disposed) return;
      /* c8 ignore stop */

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
      } else if (result && typeof (result as Promise<unknown>).then === "function") {
        // Promise-resolved values are intentionally ignored — async setups
        // register cleanup via `ctx.onCleanup(...)`, which is `disposed`-safe
        // (runs immediately if the resource was torn down mid-await). Check
        // `error.name` rather than `instanceof DOMException` so this works
        // in runtimes where DOMException isn't a global.
        (result as Promise<void>).catch((error: unknown) => {
          if ((error as { name?: string } | null)?.name === "AbortError") return;
          if (gen === generation) {
            console.error("[supergrain/resource] async setup rejected:", error);
          }
        });
      }
    }),
  );

  registerDisposer(state, () => {
    /* c8 ignore start -- public dispose() deletes the registered disposer before a second call */
    if (disposed) return;
    /* c8 ignore stop */
    disposed = true;
    stopEffect();
    runCleanups();
  });

  return state;
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
): T {
  return runResource<void, T>({
    state: createReactive(initial) as T,
    getArgs: () => undefined as void,
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
  function instantiate(argsFn?: () => Args): T {
    return runResource<Args, T>({
      state: createReactive(initial()) as T,
      getArgs: () => (argsFn ? argsFn() : (undefined as Args)),
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
 */
export function dispose(resource: object): void {
  const fn = disposers.get(resource);
  if (!fn) return;
  disposers.delete(resource);
  fn();
}
