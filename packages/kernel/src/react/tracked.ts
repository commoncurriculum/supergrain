import type { ReactiveNode } from "alien-signals";

import { effect as alienEffect } from "@supergrain/kernel";
import { getCurrentSub, setCurrentSub } from "@supergrain/kernel/internal";
import { type FC, memo, useReducer } from "react";

import { useDisposeOnUnmount } from "./use-dispose-on-unmount";

interface TrackedState {
  cleanup: () => void;
  effectNode: ReactiveNode | undefined;
}

// Per-component effect state keyed by the stable dispatch function object.
// React guarantees each component instance gets a unique dispatch reference
// from useReducer, so it doubles as a stable identity without an extra ref.
const sgStateMap = new WeakMap<(...args: Array<unknown>) => unknown, TrackedState>();

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

    // Store effect state in a WeakMap keyed by the stable dispatch function.
    // React guarantees dispatch is stable per component instance, so it
    // serves as a per-instance identity without an extra ref.
    if (!sgStateMap.has(forceUpdate)) {
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
      sgStateMap.set(forceUpdate, { cleanup, effectNode: capturedNode });
    }

    // Defer the alien-effect teardown so React 18 StrictMode's
    // mount→cleanup→remount cycle in dev doesn't kill the effect we still
    // need post-cycle.
    useDisposeOnUnmount(() => {
      sgStateMap.get(forceUpdate)!.cleanup();
      sgStateMap.delete(forceUpdate);
    });

    const state = sgStateMap.get(forceUpdate)!;
    const prev = getCurrentSub();
    setCurrentSub(state.effectNode);
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
