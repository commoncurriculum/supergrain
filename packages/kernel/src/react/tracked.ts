import { effect } from "@supergrain/kernel";
import {
  getActiveSub,
  noteReadsIn,
  setActiveSub,
  type RenderReads,
} from "@supergrain/kernel/internal";
import { type FC, memo, useEffect, useReducer } from "react";

import { type Disposer, scheduleDisposal } from "./disposal-queue";

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
    const [, update] = useReducer(increment, 0);
    // The tracker lives on the dispatch function, which is stable per
    // component instance, so it takes no extra hook.
    const holder = update as unknown as { __sg?: Tracker };
    const tracker = (holder.__sg ??= new Tracker(update));
    useEffect(tracker.mount, NO_DEPS);

    // Each render tracks into a fresh effect, and the previous one is dropped
    // only after this render has subscribed. So a computed the component
    // reads always has a subscriber, and keeps its cached state, from one
    // render to the next.
    const previous = tracker.stop;
    const kept = tracker.reads;
    const fresh = tracker.spare;
    fresh.length = 0;
    tracker.reads = fresh;
    // Made outside any active subscriber, so it isn't owned (and disposed)
    // by whatever effect happens to be running.
    const outer = setActiveSub(undefined);
    tracker.node = undefined;
    const stop = effect(tracker.run);
    tracker.stop = stop;
    setActiveSub(tracker.node);
    const outerReads = noteReadsIn(tracker);
    let rendered = false;
    try {
      const result = Component(props); // eslint-disable-line new-cap -- React function component call
      rendered = true;
      return result;
    } finally {
      // Restored even when Component(props) throws (Suspense throws a
      // Promise): otherwise every later signal read in the app would
      // subscribe to this render's effect.
      setActiveSub(outer);
      noteReadsIn(outerReads);
      if (rendered) {
        previous?.();
        tracker.spare = kept;
      } else {
        // A render that threw never shows: React keeps what it showed
        // before, so keep the effect that follows that, and drop this one.
        stop();
        tracker.stop = previous;
        tracker.reads = kept;
      }
    }
  };

  return memo(Tracked);
}

const increment = (n: number): number => n + 1;
const NO_DEPS: ReadonlyArray<unknown> = [];

/**
 * One component instance's tracking state. It makes three functions per
 * instance and none per render, so a render allocates only its effect.
 */
class Tracker implements Disposer, RenderReads {
  /** The effect node of the latest render. Undefined while it is being made. */
  node: ReturnType<typeof getActiveSub> = undefined;
  /** The derived values the latest render read (see `noteRead`). */
  reads: Array<() => unknown> = [];
  /** The other array, which the next render fills, so a render allocates none. */
  spare: Array<() => unknown> = [];
  /** Disposes the latest render's effect. Undefined before the first render. */
  stop: (() => void) | undefined = undefined;
  mounted = false;

  /**
   * The body of every render's effect. Its first run (which `effect()` makes
   * synchronously) only records the node. After that it runs when a read
   * changed: it reads the render's derived values again and re-renders.
   *
   * It reads them again because an effect drops every dependency its run
   * didn't read. Dropping them would leave a `useComputed` or `computedList`
   * the render read with no subscribers, which tears down its cached state,
   * so the re-render would rebuild it from scratch. The next render's effect
   * takes over the subscriptions. Store fields need no keeping: a signal
   * keeps its value without subscribers.
   */
  readonly run: () => void;
  /** The mount effect. */
  readonly mount: () => () => void;
  /** The mount effect's cleanup. */
  readonly unmount: () => void;

  constructor(update: () => void) {
    this.run = () => {
      // Inside an effect's run, the active subscriber is that effect.
      const node = getActiveSub()!;
      if (this.node === undefined) {
        this.node = node;
        return;
      }
      const { reads } = this;
      // eslint-disable-next-line typescript-eslint/prefer-for-of -- no iterator
      for (let i = 0; i < reads.length; i++) {
        try {
          reads[i]!();
        } catch {
          // The re-render reads it again, and throws there.
        }
      }
      update();
    };
    this.mount = () => {
      this.mounted = true;
      // Shown again after its effect was dropped (an <Activity> hid it):
      // render again, to track into a new one.
      if (this.stop === undefined) update();
      return this.unmount;
    };
    // Disposal waits until after the next paint. Unlinking is pure
    // bookkeeping with no observable output; running 1,000 of them inside
    // React's unmount commit blocks presentation of the frame that removes
    // the rows. An effect firing before then only calls `update` on an
    // unmounted component, a no-op in React.
    this.unmount = () => {
      this.mounted = false;
      scheduleDisposal(this);
    };
  }

  /**
   * Drop the latest effect, unless the component mounted again meanwhile:
   * StrictMode in development unmounts and remounts every component once.
   * Each unmount queues it, so it may run twice.
   */
  dispose(): void {
    if (this.mounted || this.stop === undefined) return;
    this.stop();
    this.stop = undefined;
  }
}
