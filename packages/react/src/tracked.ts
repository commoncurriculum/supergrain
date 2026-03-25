import { profileTimeStart, profileTimeEnd, profileEffectFire } from "@supergrain/core";
import {
  effect as alienEffect,
  getCurrentSub,
  setCurrentSub,
  type ReactiveNode,
} from "alien-signals";
import { type FC, memo, useReducer, useRef, useEffect } from "react";

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
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    const ref = useRef<{ cleanup: () => void; effectNode: ReactiveNode | undefined } | null>(null);
    profileTimeEnd("trackedHookTime");

    if (!ref.current) {
      profileTimeStart("trackedSetup");
      profileTimeStart("trackedEffectTime");
      let firstRun = true;
      let capturedNode: ReactiveNode | undefined = null!; // eslint-disable-line unicorn/no-null -- set synchronously by alienEffect
      const cleanup = alienEffect(() => {
        if (firstRun) {
          capturedNode = getCurrentSub();
          firstRun = false;
          return;
        }
        profileEffectFire();
        forceUpdate();
      });
      ref.current = { cleanup, effectNode: capturedNode };
      profileTimeEnd("trackedEffectTime");
      profileTimeEnd("trackedSetup");
    }

    profileTimeStart("trackedHookTime");
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
