import type { ReactiveNode } from "alien-signals";

import { effect as alienEffect } from "@supergrain/kernel";
import { getCurrentSub, setCurrentSub } from "@supergrain/kernel/internal";
import { type FC, memo, useReducer } from "react";

import { useDisposeOnUnmount } from "./use-dispose-on-unmount";

interface TrackedState {
  cleanup: () => void;
  effectNode: ReactiveNode | undefined;
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

    // Store effect state on the dispatch function (stable per component instance).
    // Eliminates useRef (1 fewer hook vs the original implementation).
    const fu = forceUpdate as unknown as { __sg?: TrackedState };
    if (!fu.__sg) {
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
      fu.__sg = { cleanup, effectNode: capturedNode };
    }

    // Defer the alien-effect teardown so React 18 StrictMode's
    // mount→cleanup→remount cycle in dev doesn't kill the effect we still
    // need post-cycle.
    useDisposeOnUnmount(() => {
      const fuState = (forceUpdate as unknown as { __sg?: TrackedState }).__sg;
      /* c8 ignore start -- cleanup is only registered after __sg is initialized */
      if (fuState) {
        fuState.cleanup();
        delete (forceUpdate as unknown as { __sg?: TrackedState }).__sg;
      }
      /* c8 ignore stop */
    });

    const prev = getCurrentSub();
    setCurrentSub(fu.__sg.effectNode);
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
