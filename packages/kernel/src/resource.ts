import { effect } from "alien-signals";

import { createReactive } from "./store";

/**
 * A resource is a reactive function with cleanup logic.
 *
 * The state object you pass as the first argument becomes a reactive
 * proxy (via `createReactive`). Setup mutates fields on it directly —
 * same mutation-first idiom as everything else in the library. Setup
 * runs on create, re-runs whenever any reactive value it read changes
 * (after running the previous run's cleanup), and runs final cleanup
 * on `dispose(resource)`.
 *
 * Two cleanup mechanisms, one rule each:
 * - **Sync setup** returns the cleanup: `return () => teardown()`.
 * - **Async setup** registers via `ctx.onCleanup(() => teardown())`.
 *   `return` can't work in async (it resolves a Promise, not a
 *   function). Types enforce this.
 *
 * `ctx.abortSignal` trips on every rerun and on `dispose`. Pass it to
 * `fetch`, `addEventListener({ signal })`, `IntersectionObserver`, or
 * any other API that accepts an `AbortSignal` — cancellation is
 * automatic.
 *
 * The return value is the reactive state proxy itself. Read fields
 * directly (`user.data`). To stop the resource permanently (aborting
 * in-flight work, running cleanups), call `dispose(resource)` — a free
 * function imported from the same module. At React call sites,
 * `useResource` disposes automatically on unmount.
 *
 * @example Clock (sync, return cleanup)
 * ```ts
 * const now = resource({ value: Date.now() }, (state) => {
 *   const id = setInterval(() => { state.value = Date.now(); }, 1000);
 *   return () => clearInterval(id);
 * });
 * // now.value ticks every second; dispose(now) stops it.
 * ```
 *
 * @example Async fetch with reactive input
 * ```ts
 * const userId = signal(1);
 * const user = resource(
 *   { data: null as User | null, error: null as Error | null, isLoading: true },
 *   async (state, { abortSignal }) => {
 *     state.isLoading = true;
 *     state.error = null;
 *     try {
 *       const res = await fetch(`/users/${userId()}`, { signal: abortSignal });
 *       state.data = await res.json();
 *     } catch (e) {
 *       state.error = e as Error;
 *     } finally {
 *       state.isLoading = false;
 *     }
 *   },
 * );
 * ```
 *
 * @example Async subscription with onCleanup
 * ```ts
 * const chat = resource(
 *   { messages: [] as Message[] },
 *   async (state, { onCleanup }) => {
 *     const socket = new WebSocket("wss://...");
 *     onCleanup(() => socket.close());
 *     socket.addEventListener("message", (e) => {
 *       state.messages.push(JSON.parse(e.data));
 *     });
 *   },
 * );
 * ```
 */
export interface ResourceContext {
  /**
   * An `AbortSignal` that trips when setup re-runs (tracked deps changed)
   * or when `dispose(resource)` is called. Pass it to APIs that accept
   * one — `fetch`, `addEventListener({ signal })`, observers — and
   * cancellation is wired automatically.
   */
  readonly abortSignal: AbortSignal;
  /**
   * Register a cleanup that runs before the next rerun and on final
   * `dispose`. Use this inside async setups (where `return cleanup`
   * doesn't work because the return value is a Promise). For sync
   * setups, prefer the return-cleanup pattern — it's equivalent.
   */
  onCleanup(fn: () => void): void;
}

/**
 * Disposer registry keyed on the reactive state object returned by
 * `resource()`. `dispose(resource)` looks up the teardown by reference.
 */
const disposers = new WeakMap<object, () => void>();

export function resource<T extends object>(
  initial: T,
  setup: (state: T, ctx: ResourceContext) => void | (() => void) | Promise<void>,
): T {
  const state = createReactive(initial) as T;
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

  const stopEffect = effect(() => {
    if (disposed) return;

    const gen = ++generation;
    runCleanups();
    controller = new AbortController();

    const ctx: ResourceContext = {
      abortSignal: controller.signal,
      onCleanup: (fn) => {
        // If the resource has since rerun past this registration (can
        // happen when onCleanup is called inside an async setup after
        // the run was superseded), run the cleanup immediately so it
        // still executes.
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

    const result = setup(state, ctx);

    if (typeof result === "function") {
      // Sync setup returned a cleanup.
      cleanups.push(result);
    } else if (result && typeof (result as Promise<unknown>).then === "function") {
      // Async setup — swallow unhandled rejections at the boundary.
      // Real error reporting inside setup should use try/catch and mutate state.
      (result as Promise<void>).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (gen === generation) {
          console.error("[supergrain/resource] async setup rejected:", error);
        }
      });
    }
  });

  disposers.set(state, () => {
    if (disposed) return;
    disposed = true;
    stopEffect();
    runCleanups();
  });

  return state;
}

/**
 * Stop a resource permanently. Aborts in-flight work via its
 * `AbortSignal`, runs all registered cleanups, and halts the reactive
 * effect so the setup will not re-run. Idempotent and safe to call on
 * any object — no-op if the object wasn't created by `resource()` or
 * has already been disposed.
 *
 * In React, `useResource` disposes automatically on unmount. You only
 * need to call this for module-scope resources or in tests.
 */
export function dispose(resource: object): void {
  const fn = disposers.get(resource);
  if (!fn) return;
  disposers.delete(resource);
  fn();
}
