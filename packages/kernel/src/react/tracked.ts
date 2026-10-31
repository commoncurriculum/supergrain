import type { ReactiveNode } from "alien-signals/system";

import { effect } from "@supergrain/kernel";
import { getActiveSub, setActiveSub } from "@supergrain/kernel/internal";
import { type FC, memo, useReducer } from "react";

import { scheduleDisposal } from "./disposal-queue";
import { useDisposeOnUnmount } from "./use-dispose-on-unmount";

interface TrackedState {
  cleanup: () => void;
  effectNode: ReactiveNode;
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

    // Defer the alien-effect teardown so React 18 StrictMode's
    // mount→cleanup→remount cycle in dev doesn't kill the effect we still
    // need post-cycle.
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

    // Each render tracks into a fresh effect, and the previous one is dropped
    // only after this render has subscribed. So a computed the component
    // reads always has a subscriber, and keeps its cached state, from one
    // render to the next.
    const previous = fu.__sg;
    const current = trackRender(forceUpdate);
    fu.__sg = current;

    const prev = getActiveSub();
    setActiveSub(current.effectNode);
    try {
      return Component(props); // eslint-disable-line new-cap -- React function component call
    } finally {
      // try/finally guards against React Suspense, where Component(props) throws
      // a Promise. Without this, activeSub would stay pointed at this component's
      // effect node and every subsequent signal read in the app would subscribe
      // to the wrong (now dead) effect.
      setActiveSub(prev);
      previous?.cleanup();
    }
  };

  return memo(Tracked);
}

/**
 * An effect that collects one render's reads, and calls `onChange` when one
 * of them changes.
 *
 * When it fires, it keeps its dependencies. An alien-signals effect normally
 * drops every dependency it didn't read during the run, and this one reads
 * nothing (it only schedules a re-render). Dropping them would leave the
 * computeds the render read with no subscribers, which tears down their
 * cached state, so the re-render would recompute them from scratch. The next
 * render's effect takes over the subscriptions instead.
 */
function trackRender(onChange: () => void): TrackedState {
  // Set by the effect's first run, which `effect()` makes synchronously.
  let effectNode: ReactiveNode | undefined = undefined;
  // Created outside any active subscriber, so it isn't owned (and disposed)
  // by whatever effect happens to be running.
  const prev = setActiveSub(undefined);
  try {
    const cleanup = effect(() => {
      if (effectNode === undefined) {
        effectNode = getActiveSub();
        return;
      }
      keepDependencies(effectNode);
      onChange();
    });
    return { cleanup, effectNode: effectNode! };
  } finally {
    setActiveSub(prev);
  }
}

/** Mark every current dependency as read in this run, so none are dropped. */
function keepDependencies(node: ReactiveNode): void {
  // An effect only fires through a dependency, so there is at least one.
  let link = node.deps!;
  while (link.nextDep) link = link.nextDep;
  node.depsTail = link;
}
