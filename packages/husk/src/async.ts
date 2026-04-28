import { createReactive } from "@supergrain/kernel";

import { registerDisposer, resource } from "./resource";

/**
 * A reactive async value. The envelope fields (`data`, `error`,
 * `isPending`, etc.) live on a reactive object — read them inside a
 * `tracked()` component or an `effect()` and you subscribe per-field.
 *
 * Inline sugar over `resource` for the async-envelope case. Reactive
 * reads in the sync prefix of `asyncFn` (before the first `await`) are
 * tracked — when they change, the current run is aborted via
 * `abortSignal` and a fresh run starts.
 *
 * Field names match the ecosystem (SWR / TanStack Query / Apollo /
 * URQL) and `@supergrain/silo` exactly: `.data` for the resolved value,
 * `.promise` for the stable thenable handle.
 */
export interface ReactivePromise<T> {
  readonly data: T | null;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly isResolved: boolean;
  readonly isRejected: boolean;
  readonly isSettled: boolean;
  readonly isReady: boolean;
  readonly promise: Promise<T>;
}

/**
 * Imperative async command. No auto-tracking; call `run(...)` to
 * trigger. Same envelope fields as `ReactivePromise`. Use for
 * user-initiated mutations (form submits, save buttons).
 */
export interface ReactiveTask<Args extends unknown[], T> {
  readonly data: T | null;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly isResolved: boolean;
  readonly isRejected: boolean;
  readonly isSettled: boolean;
  readonly isReady: boolean;
  run(...args: Args): Promise<T>;
}

interface PromiseEnvelope<T> {
  data: T | null;
  error: unknown;
  isPending: boolean;
  isResolved: boolean;
  isRejected: boolean;
  isSettled: boolean;
  isReady: boolean;
  promise: Promise<T>;
}

interface TaskEnvelope<Args extends unknown[], T> {
  data: T | null;
  error: unknown;
  isPending: boolean;
  isResolved: boolean;
  isRejected: boolean;
  isSettled: boolean;
  isReady: boolean;
  run: (...args: Args) => Promise<T>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Suppress unhandled-rejection warnings. Users observe rejections via
  // `await rp.promise` / `rp.promise.catch(...)` — attaching a catch
  // here creates a new branch, it doesn't swallow the rejection.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * @example
 * ```ts
 * const userId = signal(1);
 * const user = reactivePromise(async (signal) => {
 *   const res = await fetch(`/users/${userId()}`, { signal });
 *   return res.json();
 * });
 *
 * user.data;        // T | null
 * user.isPending;   // boolean
 * await user.promise;
 *
 * userId(2); // old fetch aborted, new one starts
 * ```
 */
export function reactivePromise<T>(
  asyncFn: (abortSignal: AbortSignal) => Promise<T>,
): ReactivePromise<T> {
  return resource<PromiseEnvelope<T>>(
    {
      data: null,
      error: null,
      isPending: true,
      isResolved: false,
      isRejected: false,
      isSettled: false,
      isReady: false,
      promise: deferred<T>().promise,
    },
    (state, { abortSignal }) => {
      const d = deferred<T>();
      state.promise = d.promise;
      state.isPending = true;
      state.isResolved = false;
      state.isRejected = false;

      let p: Promise<T> = Promise.resolve(null as T);
      try {
        p = Promise.resolve(asyncFn(abortSignal));
      } catch (error) {
        p = Promise.reject(error);
      }

      p.then(
        (v) => {
          if (abortSignal.aborted) return;
          state.data = v;
          state.error = null;
          state.isResolved = true;
          state.isRejected = false;
          state.isSettled = true;
          state.isReady = true;
          state.isPending = false;
          d.resolve(v);
        },
        (error) => {
          if (abortSignal.aborted) return;
          state.error = error;
          state.isResolved = false;
          state.isRejected = true;
          state.isSettled = true;
          state.isPending = false;
          d.reject(error);
        },
      );
    },
  ) as ReactivePromise<T>;
}

/**
 * @example
 * ```ts
 * const saveUser = reactiveTask(async (id: string, name: string) => {
 *   const res = await fetch(`/users/${id}`, {
 *     method: "PATCH",
 *     body: JSON.stringify({ name }),
 *   });
 *   return res.json();
 * });
 *
 * <button onClick={() => saveUser.run(id, name)} disabled={saveUser.isPending}>
 *   Save
 * </button>
 * ```
 */
export function reactiveTask<Args extends unknown[], T>(
  asyncFn: (...args: Args) => Promise<T>,
): ReactiveTask<Args, T> {
  let generation = 0;
  let disposed = false;

  const state = createReactive<TaskEnvelope<Args, T>>({
    data: null,
    error: null,
    isPending: false,
    isResolved: false,
    isRejected: false,
    isSettled: false,
    isReady: false,
    run: (...args: Args): Promise<T> => {
      if (disposed) {
        const rejected = Promise.reject(
          new Error("@supergrain/husk: reactiveTask has been disposed"),
        );
        // Attach a handler so fire-and-forget callers (e.g. an onClick that
        // dispatches `run()` without awaiting) don't surface as unhandled
        // rejections. Awaiters still observe the rejection.
        rejected.catch(() => {});
        return rejected;
      }
      const gen = ++generation;
      state.isPending = true;
      state.isResolved = false;
      state.isRejected = false;

      let p: Promise<T> = Promise.resolve(null as T);
      try {
        p = Promise.resolve(asyncFn(...args));
      } catch (error) {
        p = Promise.reject(error);
      }

      return p.then(
        (v) => {
          if (!disposed && gen === generation) {
            state.data = v;
            state.error = null;
            state.isResolved = true;
            state.isRejected = false;
            state.isSettled = true;
            state.isReady = true;
            state.isPending = false;
          }
          return v;
        },
        (error) => {
          if (!disposed && gen === generation) {
            state.error = error;
            state.isResolved = false;
            state.isRejected = true;
            state.isSettled = true;
            state.isPending = false;
          }
          throw error;
        },
      );
    },
  }) as TaskEnvelope<Args, T>;

  registerDisposer(state, () => {
    /* c8 ignore start -- public dispose() removes the disposer before it can run twice */
    if (disposed) return;
    /* c8 ignore stop */
    disposed = true;
    state.isPending = false;
  });

  return state;
}
