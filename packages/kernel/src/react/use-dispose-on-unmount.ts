import { useEffect, useRef } from "react";

// Declared locally so consumers don't need @types/node; bundlers replace it.
declare const process: { env: { NODE_ENV?: string } };

const NO_DEPS: ReadonlyArray<unknown> = [];

/**
 * Run `cleanup` when the component truly unmounts. The latest `cleanup`
 * passed is the one called.
 *
 * In development it is deferred with `setTimeout(0)` so StrictMode's
 * mount-cleanup-remount cycle doesn't trigger it. In production it runs
 * immediately.
 *
 * @example
 * ```ts
 * useDisposeOnUnmount(() => dispose(instance));
 * ```
 */
export function useDisposeOnUnmount(cleanup: () => void): void {
  const ref = useRef<Unmount | null>(null);
  const unmount = (ref.current ??= createUnmount(cleanup));
  unmount.cleanup = cleanup;
  useEffect(unmount.mount, NO_DEPS);
}

interface Unmount {
  cleanup: () => void;
  readonly mount: () => () => void;
}

function createUnmount(cleanup: () => void): Unmount {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const unmount: Unmount = { cleanup, mount };
  function mount() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    return destroy;
  }
  function destroy() {
    /* c8 ignore start -- production-only branch is selected by consumer build-time env replacement */
    if (process.env.NODE_ENV === "production") {
      unmount.cleanup();
      return;
    }
    /* c8 ignore stop */
    timer = setTimeout(run, 0);
  }
  function run() {
    timer = undefined;
    unmount.cleanup();
  }
  return unmount;
}
