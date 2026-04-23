import { signal, effect } from "alien-signals";

import { batch } from "./batch";
import { getCurrentSub, setCurrentSub } from "./internal";

/**
 * A stateful reactive value with a lifecycle (setup → rerun → dispose).
 *
 * Resources are the synchronous-or-asynchronous generalization of
 * `reactivePromise`. Unlike a plain `signal()`, a resource has a
 * **producer side-effect** — a `setup` function that runs when the
 * resource is created, reruns when any tracked signal it depends on
 * changes, and can register cleanup callbacks. Unlike a plain `effect()`,
 * a resource exposes a reactive **value** that consumers can read.
 *
 * Typical uses: timers (`setInterval`), subscriptions (`WebSocket`,
 * `IntersectionObserver`), browser APIs (`matchMedia`), async data fetches,
 * and anything else where you'd otherwise hand-roll a signal + effect pair
 * with cleanup.
 *
 * Dep-tracking rules mirror `effect()`: any reactive read during the
 * *synchronous* portion of `setup` becomes a dep. Reads after an `await`
 * won't track — grab what you need up front.
 *
 * @example Clock
 * ```ts
 * const now = resource(Date.now(), ({ set, onCleanup }) => {
 *   const id = setInterval(() => set(Date.now()), 1000);
 *   onCleanup(() => clearInterval(id));
 * });
 * // now.value ticks every second; now.dispose() stops it.
 * ```
 *
 * @example Async fetch with reactive input
 * ```ts
 * const userId = signal(1);
 * const user = resource<User | undefined>(undefined, async ({ set, signal }) => {
 *   const id = userId(); // tracked — changes trigger rerun (prev aborted)
 *   const res = await fetch(`/users/${id}`, { signal });
 *   set(await res.json());
 * });
 * ```
 */
export interface Resource<T> {
  /** Reactive current value. Reading inside `tracked()` subscribes. */
  readonly value: T;
  /** Stop the producer effect, abort in-flight work, and run cleanups. Idempotent. */
  dispose(): void;
}

export interface ResourceContext<T> {
  /** Set the current value. Batched. */
  set(value: T): void;
  /** Read the current value without subscribing to it (avoids self-dep loops). */
  peek(): T;
  /**
   * Register a cleanup to run on the next rerun (before new setup) and on
   * final dispose. Use for resources you create imperatively inside setup
   * that the returned `() => void` sugar wouldn't cover — e.g. when setup
   * is `async` and can't statically return its cleanup.
   */
  onCleanup(fn: () => void): void;
  /**
   * An `AbortSignal` that aborts when the resource reruns or disposes.
   * Hand to `fetch`, `addEventListener`, or any API that accepts one —
   * teardown is handled for you.
   */
  readonly signal: AbortSignal;
}

/**
 * Create a resource.
 *
 * Sync setup can return a cleanup function directly (`() => void`); async
 * setup must register cleanups via `onCleanup` (since the return value is
 * a Promise). Both styles are supported.
 */
export function resource<T>(
  initial: T,
  setup: (ctx: ResourceContext<T>) => void | (() => void) | Promise<void | (() => void)>,
): Resource<T> {
  const state = signal<T>(initial);
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
        // Swallowing keeps one bad cleanup from blocking others, matching
        // React's useEffect cleanup semantics. Surface to console so it's
        // not silent.
        console.error("[supergrain/resource] cleanup threw:", error);
      }
    }
  }

  const stopEffect = effect(() => {
    if (disposed) return;

    const gen = ++generation;
    runCleanups();
    controller = new AbortController();

    const ctx: ResourceContext<T> = {
      set: (v) => {
        if (gen === generation) batch(() => state(v));
      },
      peek: () => {
        // Detach from the current subscriber so reading own state inside
        // setup doesn't create a self-loop (set → rerun → peek → ...).
        const prev = getCurrentSub();
        setCurrentSub(undefined);
        try {
          return state();
        } finally {
          setCurrentSub(prev);
        }
      },
      onCleanup: (fn) => {
        // If the resource has since reruns-advanced past this registration,
        // run the cleanup immediately so it still executes.
        if (gen !== generation) {
          try {
            fn();
          } catch (error) {
            console.error("[supergrain/resource] late cleanup threw:", error);
          }
          return;
        }
        cleanups.push(fn);
      },
      signal: controller.signal,
    };

    const result = setup(ctx);

    // Sync setup returning a cleanup fn — register it.
    if (typeof result === "function") {
      cleanups.push(result);
    } else if (result && typeof (result as Promise<unknown>).then === "function") {
      // Async setup — schedule cleanup registration if it returns one.
      (result as Promise<void | (() => void)>).then(
        (fn) => {
          if (typeof fn === "function") {
            if (gen === generation) cleanups.push(fn);
            else {
              // Resource has advanced — run the cleanup now.
              try {
                fn();
              } catch (error) {
                console.error("[supergrain/resource] stale async cleanup threw:", error);
              }
            }
          }
        },
        (error) => {
          // Let aborts pass silently; surface real errors.
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (gen === generation) console.error("[supergrain/resource] setup rejected:", error);
        },
      );
    }
  });

  return {
    get value() {
      return state();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopEffect();
      runCleanups();
    },
  };
}
