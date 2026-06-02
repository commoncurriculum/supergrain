import { createReactive } from "@supergrain/kernel";
import { Effect, Either } from "effect";

import { registerDisposer, resource } from "./resource";

/**
 * A reactive async value. The envelope fields (`data`, `error`,
 * `isPending`, etc.) live on a reactive object — read them inside a
 * `tracked()` component or an `effect()` and you subscribe per-field.
 *
 * Inline sugar over `resource` for the async-envelope case. Reactive
 * reads in the body of the `effectFn` thunk (evaluated when the Effect
 * is built) are tracked — when they change, the current run is
 * interrupted and a fresh run starts.
 *
 * Field names match the ecosystem (SWR / TanStack Query / Apollo /
 * URQL) and `@supergrain/silo` exactly: `.data` for the resolved value,
 * `.promise` for the stable thenable handle.
 */
export interface ReactivePromise<T, E = unknown> {
  readonly data: T | null;
  readonly error: E | null;
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
export interface ReactiveTask<Args extends unknown[], T, E = unknown> {
  readonly data: T | null;
  readonly error: E | null;
  readonly isPending: boolean;
  readonly isResolved: boolean;
  readonly isRejected: boolean;
  readonly isSettled: boolean;
  readonly isReady: boolean;
  run(...args: Args): Promise<T>;
}

interface PromiseEnvelope<T, E> {
  data: T | null;
  error: E | null;
  isPending: boolean;
  isResolved: boolean;
  isRejected: boolean;
  isSettled: boolean;
  isReady: boolean;
  promise: Promise<T>;
}

interface TaskEnvelope<Args extends unknown[], T, E> {
  data: T | null;
  error: E | null;
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
  // eslint-disable-next-line unicorn/no-null -- Promise ctor synchronously overwrites these
  let resolve = null as unknown as (v: T) => void;
  // eslint-disable-next-line unicorn/no-null -- Promise ctor synchronously overwrites these
  let reject = null as unknown as (e: unknown) => void;
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
 * const user = reactivePromise(() =>
 *   Effect.tryPromise(() => fetch(`/users/${userId()}`).then((r) => r.json())),
 * );
 *
 * user.data;        // T | null
 * user.isPending;   // boolean
 * await user.promise;
 *
 * userId(2); // old run interrupted, new one starts
 * ```
 */
export function reactivePromise<T, E = unknown>(
  effectFn: () => Effect.Effect<T, E>,
): ReactivePromise<T, E> {
  return resource<PromiseEnvelope<T, E>>(
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

      // `effectFn()` is evaluated here, inside the tracked resource setup,
      // so reactive reads in the thunk body drive reruns. `Effect.either`
      // turns the typed error into a value; the `{ signal }` option
      // interrupts the Effect when the resource aborts on rerun/dispose.
      const p = Effect.runPromise(Effect.either(effectFn()), { signal: abortSignal });

      p.then(
        (result) => {
          if (abortSignal.aborted) return;
          if (Either.isRight(result)) {
            const v = result.right;
            state.data = v;
            state.error = null;
            state.isResolved = true;
            state.isRejected = false;
            state.isSettled = true;
            state.isReady = true;
            state.isPending = false;
            d.resolve(v);
          } else {
            const err = result.left;
            state.error = err;
            state.isResolved = false;
            state.isRejected = true;
            state.isSettled = true;
            state.isPending = false;
            d.reject(err);
          }
        },
        // Interruption (after abort) rejects the runPromise; that's
        // expected — the run was superseded, so do nothing.
        () => {},
      );
    },
  ) as ReactivePromise<T, E>;
}

/**
 * @example
 * ```ts
 * const saveUser = reactiveTask((id: string, name: string) =>
 *   Effect.tryPromise(() =>
 *     fetch(`/users/${id}`, {
 *       method: "PATCH",
 *       body: JSON.stringify({ name }),
 *     }).then((r) => r.json()),
 *   ),
 * );
 *
 * <button onClick={() => saveUser.run(id, name)} disabled={saveUser.isPending}>
 *   Save
 * </button>
 * ```
 */
export function reactiveTask<Args extends unknown[], T, E = unknown>(
  effectFn: (...args: Args) => Effect.Effect<T, E>,
): ReactiveTask<Args, T, E> {
  let generation = 0;
  let disposed = false;

  const state = createReactive<TaskEnvelope<Args, T, E>>({
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

      const p = Effect.runPromise(Effect.either(effectFn(...args)));

      return p.then((result) => {
        if (Either.isRight(result)) {
          const v = result.right;
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
        }
        const err = result.left;
        if (!disposed && gen === generation) {
          state.error = err;
          state.isResolved = false;
          state.isRejected = true;
          state.isSettled = true;
          state.isPending = false;
        }
        // Reject the returned promise so `run()`'s imperative contract
        // (awaiters observe failures) is preserved.
        throw err;
      });
    },
  }) as TaskEnvelope<Args, T, E>;

  registerDisposer(state, () => {
    disposed = true;
    state.isPending = false;
  });

  return state;
}
