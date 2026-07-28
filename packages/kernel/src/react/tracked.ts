import type { ReactiveNode } from "alien-signals/system";

import { effect as alienEffect } from "@supergrain/kernel";
import { getActiveSub, setActiveSub } from "@supergrain/kernel/internal";
import { type FC, memo, useEffect, useReducer } from "react";

import { scheduleDisposal } from "./disposal-queue";
import { useDisposeOnUnmount } from "./use-dispose-on-unmount";

// Minimal local declaration so this file doesn't require @types/node in
// downstream packages (same pattern as use-dispose-on-unmount).
declare const process: { env: { NODE_ENV?: string } };

interface TrackedState {
  cleanup: () => void;
  effectNode: ReactiveNode | undefined;
  /** refDisposal mode only — stable ref callback handed to the component. */
  trackedRef?: (el: Element | null) => (() => void) | undefined;
  /** refDisposal mode only — dev-time leak guard checks this on unmount. */
  everAttached?: boolean;
}

export interface TrackedOptions {
  /**
   * Dispose this component's reactive effect via a React 19 ref cleanup
   * instead of the default per-instance `useEffect`.
   *
   * Opting in removes one passive effect per component instance — meaningful
   * when thousands of instances mount and unmount (list rows). In exchange,
   * the component MUST attach the injected `trackedRef` prop to a DOM element
   * it renders (normally its root):
   *
   * ```tsx
   * const Row = tracked(({ item, trackedRef }) => (
   *   <tr ref={trackedRef}>…</tr>
   * ), { refDisposal: true })
   * ```
   *
   * If the ref is never attached, the effect is not disposed on unmount (it
   * leaks until the store itself is garbage). Development builds detect this
   * and warn; production builds trust the contract. Leave this option off —
   * the default — and `tracked()` requires nothing from the component.
   */
  refDisposal?: boolean;
}

/** Extra prop injected into the wrapped component when `refDisposal` is on. */
export interface TrackedRefProps {
  /** Attach to the component's root DOM element. Undefined unless the
   * component was wrapped with `tracked(C, { refDisposal: true })`. */
  trackedRef?: (el: Element | null) => (() => void) | undefined;
}

/**
 * Wraps a React component with per-component signal scoping.
 *
 * All reactive proxy reads during the component's render are tracked to
 * that component's own alien-signals effect. When any tracked signal
 * changes, only this component re-renders — not the parent.
 *
 * Also wraps the component in React.memo for standard memoization.
 *
 * Safe on non-reactive components: if no reactive proxies are read,
 * the effect has zero dependencies and never fires. The component
 * behaves identically to memo().
 *
 * @example
 * ```tsx
 * // <Provider initial={{ selected: null as number | null }}>...
 *
 * const Row = tracked(({ item }) => {
 *   const store = useStore()
 *   // item.label read is scoped to this Row's effect.
 *   // A label change on this item re-renders only this Row.
 *   const isSelected = useComputed(() => store.selected === item.id)
 *   return (
 *     <tr className={isSelected ? 'danger' : ''}>
 *       <td>{item.id}</td>
 *       <td>{item.label}</td>
 *     </tr>
 *   )
 * })
 *
 * const App = tracked(() => {
 *   const store = Store.useStore()
 *   return (
 *     <For each={store.data}>
 *       {(item) => <Row key={item.id} item={item} />}
 *     </For>
 *   )
 * })
 * ```
 */
export function tracked<P extends object>(
  Component: FC<P & TrackedRefProps>,
  options?: TrackedOptions,
) {
  // Constant for the lifetime of the wrapped component, so branching the hook
  // list on it below is safe (same reasoning as the NODE_ENV branch in
  // useDisposeOnUnmount): within one component type the branch never changes.
  const refDisposal = options?.refDisposal === true;

  const Tracked: FC<P> = (props: P) => {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    // Store effect state on the dispatch function (stable per component instance).
    // Eliminates useRef (1 fewer hook vs the original implementation).
    const fu = forceUpdate as unknown as { __sg?: TrackedState };
    if (!fu.__sg) {
      let firstRun = true;
      let capturedNode: ReactiveNode | undefined = null!; // eslint-disable-line unicorn/no-null -- set synchronously by alienEffect
      const cleanup = alienEffect(() => {
        if (firstRun) {
          capturedNode = getActiveSub();
          firstRun = false;
          return;
        }
        forceUpdate();
      });
      const state: TrackedState = { cleanup, effectNode: capturedNode };

      if (refDisposal) {
        // Ref-cleanup disposal: no per-instance useEffect. React detaches
        // refs synchronously in the unmount commit, so the detach callback
        // must stay O(1) — it only flags and queues; the graph unlink happens
        // in the deferred flush, off the paint-critical path.
        //
        // StrictMode (dev) runs attach → cleanup → re-attach on mount. The
        // `detached` flag makes the queued disposer a no-op if the ref was
        // re-attached before the flush ran, mirroring useDisposeOnUnmount's
        // timer-cancellation dance.
        let detached = false;
        let disposed = false;
        state.everAttached = false;
        state.trackedRef = (el: Element | null) => {
          /* c8 ignore next -- React 19 never calls a cleanup-returning ref with null */
          if (el === null) return;
          detached = false;
          state.everAttached = true;
          return () => {
            detached = true;
            scheduleDisposal(() => {
              if (detached && !disposed) {
                disposed = true;
                state.cleanup();
              }
            });
          };
        };
      }
      fu.__sg = state;
    }

    if (refDisposal) {
      /* c8 ignore start -- dev-only leak guard; the production branch is selected by consumer build-time env replacement */
      if (process.env.NODE_ENV !== "production") {
        // Dev-only backstop for the refDisposal contract: if the component
        // never attached trackedRef, its effect would silently leak. Warn and
        // dispose here instead. Passive cleanups run after refs attach, so a
        // correctly-wired component never triggers this.
        // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is constant per component type; bundlers DCE the dev path
        useEffect(
          () => () => {
            const fuLatest = forceUpdate as unknown as { __sg?: TrackedState };
            const state = fuLatest.__sg;
            if (state && !state.everAttached) {
              console.warn(
                "tracked(…, { refDisposal: true }): component unmounted without ever attaching its trackedRef prop to a DOM element. " +
                  "Its reactive effect would leak in production. Attach `trackedRef` to the component's root element, or remove the refDisposal option.",
              );
              scheduleDisposal(state.cleanup);
              delete fuLatest.__sg;
            }
          },
          [],
        );
      }
      /* c8 ignore stop */
    } else {
      // Defer the alien-effect teardown so React 18 StrictMode's
      // mount→cleanup→remount cycle in dev doesn't kill the effect we still
      // need post-cycle.
      // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is constant per component type (refDisposal is fixed at wrap time)
      useDisposeOnUnmount(() => {
        const fu = forceUpdate as unknown as { __sg?: TrackedState };
        // Defer the signal-graph unlink past the next paint. Unlinking is pure
        // bookkeeping with no observable output; running 1,000 of them inside
        // React's unmount commit blocks presentation of the frame that removes
        // the rows. A spurious effect firing before the deferred flush only
        // calls forceUpdate on an unmounted component — a no-op in React.
        scheduleDisposal(fu.__sg!.cleanup);
        delete fu.__sg;
      });
    }

    const prev = getActiveSub();
    setActiveSub(fu.__sg.effectNode);
    try {
      // eslint-disable-next-line new-cap -- React function component call
      return Component(
        // The non-null assertion holds by construction: refDisposal implies the
        // state-creation branch above populated trackedRef.
        refDisposal
          ? { ...props, trackedRef: fu.__sg.trackedRef! }
          : (props as P & TrackedRefProps),
      );
    } finally {
      // try/finally guards against React Suspense, where Component(props) throws
      // a Promise. Without this, activeSub would stay pointed at this component's
      // effect node and every subsequent signal read in the app would subscribe
      // to the wrong (now dead) effect.
      setActiveSub(prev);
    }
  };

  return memo(Tracked);
}
