import { effect as alienEffect, getCurrentSub, setCurrentSub } from "alien-signals";
import { profileTimeStart, profileTimeEnd, profileEffectFire } from "@supergrain/core";
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
export function tracked<P extends object>(Component: FC<P>) {
  const Tracked: FC<P> = (props: P) => {
    profileTimeStart("trackedHookTime");
    const ref = useRef<{
      cleanup: () => void;
      effectNode: any;
      version: number;
      subscribe: (cb: () => void) => () => void;
      getSnapshot: () => number;
    } | null>(null);
    profileTimeEnd("trackedHookTime");

    if (!ref.current) {
      profileTimeStart("trackedSetup");
      profileTimeStart("trackedEffectTime");
      let effectNode: any = null;
      let firstRun = true;
      let version = 0;
      let listener: (() => void) | null = null;
      // Use alienEffect directly to avoid profiledEffect's double-callback overhead.
      // profileEffectFire() is called manually on re-runs.
      const cleanup = alienEffect(() => {
        if (firstRun) {
          effectNode = getCurrentSub();
          firstRun = false;
          return;
        }
        profileEffectFire();
        version++;
        listener?.();
      });
      ref.current = {
        cleanup,
        effectNode,
        version,
        subscribe(cb: () => void) {
          listener = cb;
          return () => {
            listener = null;
          };
        },
        getSnapshot() {
          return version;
        },
      };
      profileTimeEnd("trackedEffectTime");
      profileTimeEnd("trackedSetup");
    }

    profileTimeStart("trackedHookTime");
    useSyncExternalStore(ref.current.subscribe, ref.current.getSnapshot);

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
