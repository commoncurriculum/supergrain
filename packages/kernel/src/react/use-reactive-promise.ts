import { dispose } from "@supergrain/kernel";
import { useEffect, useMemo } from "react";

import { reactivePromise, type ReactivePromise } from "../async";

/**
 * Creates a `reactivePromise` scoped to the component lifecycle.
 * Disposes the underlying effect and aborts the in-flight run when the
 * component unmounts or when `deps` change.
 *
 * Pass `deps` for non-signal values that should invalidate the whole
 * reactive promise (e.g. a prop that changes the shape of the async
 * work). Signal reads inside `asyncFn` are tracked automatically —
 * don't put them in `deps`.
 *
 * @example
 * ```tsx
 * const User = tracked(({ id }: { id: string }) => {
 *   const q = useReactivePromise(async (abortSignal) => {
 *     const res = await fetch(`/users/${id}`, { signal: abortSignal });
 *     return res.json();
 *   }, [id]);
 *   if (q.isPending && !q.isReady) return <Spinner />;
 *   if (q.error) return <Error err={q.error} />;
 *   return <Card data={q.data!} />;
 * });
 * ```
 */
export function useReactivePromise<T>(
  asyncFn: (abortSignal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): ReactivePromise<T> {
  const rp = useMemo(() => reactivePromise(asyncFn), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => dispose(rp), [rp]);
  return rp;
}
