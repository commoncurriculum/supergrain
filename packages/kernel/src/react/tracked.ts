import { effect } from "@supergrain/kernel";
import {
  endReads,
  getActiveSub,
  RenderReads,
  setActiveSub,
  startReads,
} from "@supergrain/kernel/internal";
import { type FC, memo, useEffect, useReducer } from "react";

import { type Disposer, scheduleDisposal } from "./disposal-queue";

/**
 * Wraps a React component (in `memo`) so the store reads in its render are
 * tracked to that component alone: when one changes, only it re-renders.
 * A component that reads nothing reactive behaves exactly like `memo()`.
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
 *   const store = useStore()
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
    const [, update] = useReducer(increment, 0);
    // Stashed on React's dispatch function, which is stable per instance.
    const holder = update as unknown as { __sg?: Tracker };
    const tracker = (holder.__sg ??= new Tracker(update));
    useEffect(tracker.mount, NO_DEPS);

    // Drop the previous effect only after this render subscribed, so computeds
    // never lose their last subscriber (and their cache) between renders.
    const previous = tracker.stop;
    // alien-signals makes an effect created under an active subscriber its
    // child, disposed with it.
    const outer = setActiveSub(undefined);
    tracker.node = undefined;
    const stop = effect(tracker.run);
    tracker.stop = stop;
    setActiveSub(tracker.node);
    const outerReads = startReads(tracker);
    let rendered = false;
    try {
      const result = Component(props); // eslint-disable-line new-cap -- React function component call
      rendered = true;
      return result;
    } finally {
      // Must restore even on throw (Suspense throws a Promise), or every later
      // read in the app subscribes to this effect.
      setActiveSub(outer);
      endReads(tracker, outerReads, rendered);
      if (rendered) {
        previous?.();
      } else {
        // React keeps showing the previous render, so keep its effect.
        stop();
        tracker.stop = previous;
      }
    }
  };

  return memo(Tracked);
}

const increment = (n: number): number => n + 1;
const NO_DEPS: ReadonlyArray<unknown> = [];

class Tracker extends RenderReads implements Disposer {
  stop: (() => void) | undefined = undefined;
  mounted = false;

  // effect() runs this synchronously once on creation: that run only records the node.
  readonly run: () => void;
  readonly mount: () => () => void;
  readonly unmount: () => void;

  constructor(update: () => void) {
    super();
    this.run = () => {
      const node = getActiveSub()!;
      if (this.node === undefined) {
        this.node = node;
        return;
      }
      this.readAgain();
      update();
    };
    this.mount = () => {
      this.mounted = true;
      // Re-shown after an <Activity> hid it and its effect was dropped.
      if (this.stop === undefined) update();
      return this.unmount;
    };
    // Deferred: an effect firing before then only calls `update` on an
    // unmounted component, which React ignores.
    this.unmount = () => {
      this.mounted = false;
      scheduleDisposal(this);
    };
  }

  // StrictMode unmounts and remounts once: skip if remounted. May run twice.
  dispose(): void {
    if (this.mounted || this.stop === undefined) return;
    this.stop();
    this.stop = undefined;
  }
}
