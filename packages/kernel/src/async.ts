/* eslint-disable unicorn/no-thenable -- ReactivePromise is intentionally thenable. */
import { signal } from "alien-signals";

import { batch } from "./batch";
import { resource } from "./resource";

/**
 * A reactive async value. Wraps a Promise with reactive state fields that
 * update as the underlying async work progresses. All fields are signals,
 * so reading them inside a `tracked()` component or an `effect()` subscribes
 * the reader to changes.
 *
 * Ergonomic sugar over `resource()` for the async-envelope case. The
 * lifecycle (run on create, rerun on tracked signal change, abort-previous)
 * is delegated to `resource`; this adds the `{ value, error, isPending,
 * isResolved, ... }` envelope + thenable on top.
 *
 * The async function re-runs whenever any signal it read (before its first
 * `await`) changes. Previous in-flight runs are aborted via the
 * `AbortSignal` argument; their resolutions are discarded.
 *
 * Thenable: `await rp` resolves to the current run's result. If deps change
 * mid-await, you still get whichever run was current at `.then()` time.
 *
 * **Dep-tracking caveat:** only signals read *before the first `await`* in
 * `asyncFn` are tracked. Reads after `await` won't register as deps, because
 * the synchronous subscriber frame has already unwound. Grab what you need
 * up front.
 */
export interface ReactivePromise<T> extends PromiseLike<T> {
  readonly value: T | null;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly isResolved: boolean;
  readonly isRejected: boolean;
  readonly isSettled: boolean;
  readonly isReady: boolean;
  dispose(): void;
  then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2>;
  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<T | R>;
  finally(onFinally?: (() => void) | null): Promise<T>;
}

/**
 * Imperative async command. No auto-tracking; call `run(...)` to trigger.
 * Same reactive state fields as `ReactivePromise`. Use for user-initiated
 * mutations; use `reactivePromise()` for derived async values that re-run
 * when a signal changes.
 */
export interface ReactiveTask<Args extends unknown[], T> {
  readonly value: T | null;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly isResolved: boolean;
  readonly isRejected: boolean;
  readonly isSettled: boolean;
  readonly isReady: boolean;
  run(...args: Args): Promise<T>;
}

function createState<T>() {
  return {
    value: signal<T | null>(null),
    error: signal<unknown>(null),
    pending: signal(false),
    resolved: signal(false),
    rejected: signal(false),
    settled: signal(false),
    ready: signal(false),
  };
}

type State<T> = ReturnType<typeof createState<T>>;

function onStart<T>(s: State<T>) {
  batch(() => {
    s.pending(true);
    s.resolved(false);
    s.rejected(false);
  });
}

function onResolved<T>(s: State<T>, v: T) {
  batch(() => {
    s.value(v);
    s.error(null);
    s.resolved(true);
    s.rejected(false);
    s.settled(true);
    s.ready(true);
    s.pending(false);
  });
}

function onRejectedState<T>(s: State<T>, error: unknown) {
  batch(() => {
    s.error(error);
    s.resolved(false);
    s.rejected(true);
    s.settled(true);
    s.pending(false);
  });
}

/**
 * @example
 * ```ts
 * const userId = signal(1);
 * const userQuery = reactivePromise(async (abort) => {
 *   const id = userId();                             // tracked
 *   const res = await fetch(`/users/${id}`, { signal: abort });
 *   return res.json();
 * });
 * userId(2); // previous fetch aborted, new one starts
 * ```
 */
export function reactivePromise<T>(
  asyncFn: (signal: AbortSignal) => Promise<T>,
): ReactivePromise<T> {
  const s = createState<T>();
  let currentPromise: Promise<T> = Promise.resolve() as Promise<T>;

  // Delegate the "run, track deps, rerun on change, abort previous, cleanup
  // on dispose" lifecycle to resource. We only manage the envelope signals
  // and the stored thenable handle.
  const r = resource<null>(null, ({ signal: abortSignal }) => {
    onStart(s);

    const p: Promise<T> = (() => {
      try {
        return Promise.resolve(asyncFn(abortSignal));
      } catch (error) {
        return Promise.reject(error);
      }
    })();

    currentPromise = p.then(
      (v) => {
        if (!abortSignal.aborted) onResolved(s, v);
        return v;
      },
      (error) => {
        if (!abortSignal.aborted) onRejectedState(s, error);
        throw error;
      },
    );
    // Suppress unhandled-rejection warnings on the stored promise. Users
    // observe rejections via `await rp` / `rp.catch(...)` on this same
    // promise — attaching a catch here creates a new branch, it doesn't
    // swallow the rejection for users.
    currentPromise.catch(() => {});
  });

  return {
    get value() {
      return s.value();
    },
    get error() {
      return s.error();
    },
    get isPending() {
      return s.pending();
    },
    get isResolved() {
      return s.resolved();
    },
    get isRejected() {
      return s.rejected();
    },
    get isSettled() {
      return s.settled();
    },
    get isReady() {
      return s.ready();
    },
    dispose() {
      r.dispose();
    },
    then(onFulfilled, onRejected) {
      return currentPromise.then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return currentPromise.catch(onRejected);
    },
    finally(onFinally) {
      return currentPromise.finally(onFinally);
    },
  };
}

/**
 * @example
 * ```ts
 * const saveUser = reactiveTask(async (id: string, name: string) => {
 *   const res = await fetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
 *   return res.json();
 * });
 * <button onClick={() => saveUser.run(id, name)} disabled={saveUser.isPending}>Save</button>
 * ```
 */
export function reactiveTask<Args extends unknown[], T>(
  asyncFn: (...args: Args) => Promise<T>,
): ReactiveTask<Args, T> {
  const s = createState<T>();
  let generation = 0;

  function run(...args: Args): Promise<T> {
    const gen = ++generation;
    onStart(s);

    const p: Promise<T> = (() => {
      try {
        return Promise.resolve(asyncFn(...args));
      } catch (error) {
        return Promise.reject(error);
      }
    })();

    return p.then(
      (v) => {
        if (gen === generation) onResolved(s, v);
        return v;
      },
      (error) => {
        if (gen === generation) onRejectedState(s, error);
        throw error;
      },
    );
  }

  return {
    get value() {
      return s.value();
    },
    get error() {
      return s.error();
    },
    get isPending() {
      return s.pending();
    },
    get isResolved() {
      return s.resolved();
    },
    get isRejected() {
      return s.rejected();
    },
    get isSettled() {
      return s.settled();
    },
    get isReady() {
      return s.ready();
    },
    run,
  };
}
