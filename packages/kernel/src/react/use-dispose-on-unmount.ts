import { useEffect, useRef } from "react";

// Minimal local declaration so this file doesn't require @types/node in
// downstream packages. Consumer bundlers (and Vite library mode) replace
// `process.env.NODE_ENV` based on their build, which is what we want.
declare const process: { env: { NODE_ENV?: string } };

const NO_DEPS: ReadonlyArray<unknown> = [];

/**
 * Run `cleanup` when the component truly unmounts.
 *
 * Its functions are made once per component instance, so a render allocates
 * nothing here. Pass a stable `cleanup` to allocate nothing per render at
 * all; a new one each render also works, and the latest is the one called.
 *
 * In development the cleanup is deferred with `setTimeout(0)`, so it survives
 * React 18 StrictMode's mount→cleanup→remount cycle: the remount clears the
 * pending timer, and on a real unmount the timer survives and runs the
 * cleanup. In production it runs straight away. Bundlers replace
 * `process.env.NODE_ENV` at build time and drop the development branch.
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
  /** The effect: clears a pending development timer, and returns `destroy`. */
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
