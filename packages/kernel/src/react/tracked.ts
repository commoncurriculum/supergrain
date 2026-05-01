import type { ReactiveNode } from "alien-signals";

import { effect as alienEffect } from "@supergrain/kernel";
import { getCurrentSub, setCurrentSub } from "@supergrain/kernel/internal";
import { type FC, memo, useEffect, useReducer } from "react";

import { useDisposeOnUnmount } from "./use-dispose-on-unmount";

declare const process: { env: { NODE_ENV?: string } };

const TRACKED_STATE = Symbol.for("supergrain:tracked-state");

interface TrackedState {
  cleanup: () => void;
  effectNode: ReactiveNode | undefined;
  // Stable closures hoisted into first-render setup so subsequent renders
  // pass the same function references to React (no per-render closure
  // allocation, no useRef indirection inside useDisposeOnUnmount).
  onUnmount: () => void;
  effectSetup: () => () => void;
}

// We piggyback our per-instance state on the `forceUpdate` dispatch function
// returned by useReducer. React guarantees that ref is stable across renders,
// which is exactly what we need to skip a useRef hook. This typed alias just
// gives us a place to declare the symbol-keyed slot — the underlying value is
// the dispatch function itself.
interface DispatchHost {
  [TRACKED_STATE]?: TrackedState;
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
export function tracked<P extends object>(Component: FC<P>) {
  const Tracked: FC<P> = (props: P) => {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    // Store effect state on the dispatch function (stable per component
    // instance). Eliminates useRef (1 fewer hook vs the original
    // implementation).
    const dispatchHost = forceUpdate as unknown as DispatchHost;
    let trackedState = dispatchHost[TRACKED_STATE];
    if (!trackedState) {
      let firstRun = true;
      let capturedNode: ReactiveNode | undefined = null!; // eslint-disable-line unicorn/no-null -- set synchronously by alienEffect
      const cleanup = alienEffect(() => {
        if (firstRun) {
          capturedNode = getCurrentSub();
          firstRun = false;
          return;
        }
        forceUpdate();
      });
      // Hoist the unmount closure so we don't allocate a fresh arrow on
      // every render to pass into the effect. `dispatchHost` (== forceUpdate)
      // is stable per React's useReducer contract, so capturing it here is
      // safe for the component's lifetime.
      const onUnmount = (): void => {
        dispatchHost[TRACKED_STATE]!.cleanup();
        delete dispatchHost[TRACKED_STATE];
      };
      // Stable effect-setup function: passing the same reference to
      // useEffect on every render lets React's deps comparison
      // short-circuit and skips per-render closure allocation.
      const effectSetup = (): (() => void) => onUnmount;
      trackedState = { cleanup, effectNode: capturedNode, onUnmount, effectSetup };
      dispatchHost[TRACKED_STATE] = trackedState;
    }

    /* c8 ignore start -- dev-only branch is selected by consumer build-time env replacement */
    if (process.env.NODE_ENV === "production") {
      // Production: a single useEffect with empty deps. The stable
      // `effectSetup` reference means React's deps comparison short-circuits
      // and we skip the useRef + per-render closure that
      // `useDisposeOnUnmount` carries (1 hook + 1 closure saved per render).
      // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is build-time constant
      useEffect(trackedState.effectSetup, []);
    } else {
      // Dev StrictMode: defer cleanup via setTimeout so the
      // mount→cleanup→remount cycle doesn't kill the alien-effect.
      // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is build-time constant
      useDisposeOnUnmount(trackedState.onUnmount);
    }
    /* c8 ignore stop */

    const prev = getCurrentSub();
    setCurrentSub(trackedState.effectNode);
    try {
      return Component(props); // eslint-disable-line new-cap -- React function component call
    } finally {
      // try/finally guards against React Suspense, where Component(props) throws
      // a Promise. Without this, activeSub would stay pointed at this component's
      // effect node and every subsequent signal read in the app would subscribe
      // to the wrong (now dead) effect.
      setCurrentSub(prev);
    }
  };

  return memo(Tracked);
}
