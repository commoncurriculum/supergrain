import { resource } from "./resource";
import { createReactive } from "./store";

/**
 * A reactive async value. The envelope fields (`data`, `error`,
 * `isPending`, etc.) live on a reactive object — read them inside a
 * `tracked()` component or an `effect()` and you subscribe per-field.
 *
 * Ergonomic sugar over `resource()` for the async-envelope case. The
 * lifecycle (run on create, rerun on tracked signal change, abort
 * previous) is delegated to `resource`; this adds the standard
 * `{ data, error, isPending, ... }` envelope plus a `promise` field for
 * `await` and React 19 `use()`.
 *
 * The async function re-runs whenever any signal it read (before its
 * first `await`) changes. Previous in-flight runs are aborted via the
 * `AbortSignal` argument; their resolutions are discarded.
 *
 * Field names match the ecosystem (SWR / TanStack Query / Apollo / URQL)
 * and `@supergrain/silo` exactly: `.data` for the resolved value,
 * `.promise` for the stable thenable handle.
 *
 * **Dep-tracking caveat:** only signals read *before the first `await`*
 * in `asyncFn` are tracked. Reads after `await` won't register as deps,
 * because the synchronous subscriber frame has already unwound. Grab
 * what you need up front.
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
 * user-initiated mutations (form submits, save buttons); use
 * `reactivePromise()` for derived async values that re-run when a signal
 * changes.
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

const noopResolve: (v: unknown) => void = () => {};
const noopReject: (e: unknown) => void = () => {};

function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = noopResolve as (v: T) => void;
  let reject: (e: unknown) => void = noopReject;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Suppress unhandled-rejection warnings. Users observe rejections
  // via `await rp.promise` / `rp.promise.catch(...)` — attaching a
  // catch here creates a new branch, it doesn't swallow the rejection
  // for users.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * @example
 * ```ts
 * const userId = signal(1);
 * const userQuery = reactivePromise(async (abortSignal) => {
 *   const id = userId();                                  // tracked
 *   const res = await fetch(`/users/${id}`, { signal: abortSignal });
 *   return res.json();
 * });
 * // userQuery.data, userQuery.isPending, etc.
 * // await userQuery.promise
 * userId(2); // previous fetch aborted, new one starts
 * ```
 */
export function reactivePromise<T>(
  asyncFn: (abortSignal: AbortSignal) => Promise<T>,
): ReactivePromise<T> {
  const initial = deferred<T>();

  // Delegate the lifecycle (track deps, rerun on change, abort previous,
  // cleanup on dispose) to resource. We mutate the envelope fields and
  // replace state.promise each run so consumers watching `rp.promise`
  // see the latest handle.
  return resource<PromiseEnvelope<T>>(
    {
      data: null,
      error: null,
      isPending: true,
      isResolved: false,
      isRejected: false,
      isSettled: false,
      isReady: false,
      promise: initial.promise,
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
  );
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
 * <button onClick={() => saveUser.run(id, name)} disabled={saveUser.isPending}>
 *   Save
 * </button>
 * ```
 */
export function reactiveTask<Args extends unknown[], T>(
  asyncFn: (...args: Args) => Promise<T>,
): ReactiveTask<Args, T> {
  let generation = 0;

  // Envelope as a reactive object. Users read `task.data`, `task.isPending`,
  // and call `task.run(...)` — all flat access.
  const state = createReactive<TaskEnvelope<Args, T>>({
    data: null,
    error: null,
    isPending: false,
    isResolved: false,
    isRejected: false,
    isSettled: false,
    isReady: false,
    // `run` is a function on the reactive proxy. Reading it tracks (same
    // as any field), but its reference never changes, so subscribers
    // never invalidate on it. Method calls work naturally.
    run: (...args: Args): Promise<T> => {
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
          if (gen === generation) {
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
          if (gen === generation) {
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

  return state;
}
