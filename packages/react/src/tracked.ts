import {
  effect,
  getCurrentSub,
  setCurrentSub,
  profileTimeStart,
  profileTimeEnd,
  type ReactiveNode,
} from "@supergrain/core";
import { type FC, memo, useEffect, useRef, useSyncExternalStore } from "react";

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
 * const Store = provideStore(store)
 *
 * const Row = tracked(({ item }) => {
 *   const store = Store.useStore()
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

/** Internal state for a tracked component instance. */
interface TrackedState {
  cleanup: () => void;
  effectNode: ReactiveNode | undefined;
  version: number;
  listener: (() => void) | null;
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => number;
  unsubscribe: () => void;
}

export function tracked<P extends object>(Component: FC<P>) {
  const Tracked: FC<P> = (props: P) => {
    profileTimeStart("trackedHookTime");
    const ref = useRef<TrackedState | null>(null);
    profileTimeEnd("trackedHookTime");

    if (!ref.current) {
      profileTimeStart("trackedSetup");
      profileTimeStart("trackedEffectTime");
      // All mutable state lives on the state object to minimize closure contexts.
      // subscribe/getSnapshot/unsubscribe close over `state` only (one V8 Context).
      const state: TrackedState = {
        effectNode: undefined,
        version: 0,
        listener: null,
        cleanup: null!,
        unsubscribe() {
          state.listener = null;
        },
        subscribe(cb: () => void) {
          state.listener = cb;
          return state.unsubscribe;
        },
        getSnapshot() {
          return state.version;
        },
      };

      let firstRun = true;
      state.cleanup = effect(() => {
        if (firstRun) {
          state.effectNode = getCurrentSub();
          firstRun = false;
          return;
        }
        state.version++;
        state.listener?.();
      });

      ref.current = state;
      profileTimeEnd("trackedEffectTime");
      profileTimeEnd("trackedSetup");
    }

    profileTimeStart("trackedHookTime");
    useSyncExternalStore(ref.current.subscribe, ref.current.getSnapshot, ref.current.getSnapshot);

    useEffect(
      () => () => {
        profileTimeStart("effectCleanupTime");
        ref.current?.cleanup?.();
        ref.current = null;
        profileTimeEnd("effectCleanupTime");
      },
      [],
    );
    profileTimeEnd("trackedHookTime");

    profileTimeStart("trackedRenderTime");
    const prev = getCurrentSub();
    setCurrentSub(ref.current.effectNode);
    const result = Component(props); // eslint-disable-line new-cap -- React function component call
    setCurrentSub(prev);
    profileTimeEnd("trackedRenderTime");
    return result;
  };

  return memo(Tracked);
}
