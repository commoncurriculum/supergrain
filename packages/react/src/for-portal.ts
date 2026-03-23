import { effect as alienEffect, getCurrentSub, setCurrentSub, unwrap } from "@supergrain/core";
import React, { useEffect, useLayoutEffect, useRef } from "react";

import { tracked } from "./tracked";

const $TRACK = Symbol.for("supergrain:track");
const $NODE = Symbol.for("supergrain:node");

interface ForPortalProps<T> {
  each: T[];
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
  parent: React.RefObject<Element | null>;
}

/**
 * Internal slot component with item caching for O(1) swap support.
 *
 * Caches its item in a ref. Only re-reads from the array when the index
 * prop changes (structural change). On property-change re-renders, uses
 * the cached item — so it always renders the correct item even if the
 * DOM was moved by the alien swap effect.
 */
const ForPortalItem = tracked(
  ({
    each,
    index,
    children,
  }: {
    each: unknown[];
    index: number;
    children: (item: unknown, index: number) => React.ReactNode;
  }) => {
    const prevIndexRef = useRef(index);
    const itemRef = useRef<unknown>(undefined);

    // Read item from array only on first render or when index changes
    // (structural change — For re-renders with new keys/indices).
    // Read WITHOUT subscribing to per-index signal — the alien effect
    // handles swap positioning, not React.
    if (itemRef.current === undefined || prevIndexRef.current !== index) {
      const prevSub = getCurrentSub();
      setCurrentSub(undefined as any);
      itemRef.current = each[index];
      setCurrentSub(prevSub);
      prevIndexRef.current = index;
    }

    // Render with cached item — subscribes to item PROPERTY signals
    // (label, id, etc.) via the children render function.
    const child = children(itemRef.current, index);
    return child as React.ReactElement;
  },
);

/**
 * List renderer with O(1) keyed swap via direct DOM moves.
 *
 * Same API as `<For>`, but requires a `parent` ref to the container
 * element. On swap, an alien-signals effect moves DOM nodes directly
 * via insertBefore. ForPortalItem caches its item, so label changes
 * still render correctly after a DOM move.
 *
 * - Swap: Alien effect moves 2 DOM nodes. O(1). Zero React work.
 * - Add/Remove: ForPortal re-renders to adjust slot count. React handles it.
 * - Property update: Only the affected ForPortalItem re-renders.
 *
 * @example
 * ```tsx
 * const tbodyRef = useRef<HTMLTableSectionElement>(null)
 * <table>
 *   <tbody ref={tbodyRef}>
 *     <ForPortal each={store.data} parent={tbodyRef}>
 *       {(item) => (
 *         <tr>
 *           <td>{item.id}</td>
 *           <td>{item.label}</td>
 *         </tr>
 *       )}
 *     </ForPortal>
 *   </tbody>
 * </table>
 * ```
 */
export const ForPortal = tracked((props: ForPortalProps<unknown>) => {
  const { each, children, fallback, parent } = props;
  const prevRawRef = useRef<unknown[]>([]);
  const swapCleanupRef = useRef<(() => void) | null>(null);

  // Subscribe to structural changes (ownKeys: add, remove, splice).
  void (each as any)?.[$TRACK];

  const raw = unwrap(each);

  // Alien swap effect — recreated on every render to stay in sync.
  // ForPortal only re-renders on structural changes (not swap), so
  // this doesn't fire on the hot path.
  useLayoutEffect(() => {
    if (!raw || raw.length === 0) {
      swapCleanupRef.current?.();
      swapCleanupRef.current = null;
      return;
    }

    swapCleanupRef.current?.();
    prevRawRef.current = raw.slice();

    const cleanup = alienEffect(() => {
      // Subscribe to per-index signals.
      const nodes = (raw as any)[$NODE];
      for (let i = 0; i < raw.length; i++) {
        if (nodes?.[i]) {
          nodes[i]();
        } else {
          void each[i];
        }
      }

      // Detect swap
      const prev = prevRawRef.current;
      const container = parent.current;
      if (!container || prev.length !== raw.length) {
        prevRawRef.current = raw.slice();
        return;
      }

      const changed: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== prev[i]) {
          changed.push(i);
          if (changed.length > 2) break;
        }
      }

      if (changed.length === 2) {
        const [a, b] = changed;
        const domChildren = container.children;
        const nodeA = domChildren[a];
        const nodeB = domChildren[b];
        if (nodeA && nodeB) {
          const siblingA = nodeA.nextSibling === nodeB ? nodeA : nodeA.nextSibling;
          container.insertBefore(nodeA, nodeB.nextSibling);
          container.insertBefore(nodeB, siblingA);
        }
      }

      prevRawRef.current = raw.slice();
    });

    swapCleanupRef.current = cleanup;
    return cleanup;
  });

  // Cleanup on unmount
  useEffect(
    () => () => {
      swapCleanupRef.current?.();
    },
    [],
  );

  if (!raw || raw.length === 0) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }

  // Key by ID for correct React reconciliation on add/remove.
  // ForPortal does NOT subscribe to per-index signals — it does not
  // re-render on swap. The alien effect handles DOM moves.
  const slots = [];
  for (let i = 0; i < raw.length; i++) {
    const rawItem = raw[i];
    const key =
      rawItem && typeof rawItem === "object" && "id" in rawItem
        ? ((rawItem as Record<string, unknown>).id as React.Key)
        : i;

    slots.push(
      React.createElement(ForPortalItem, {
        key,
        each,
        index: i,
        children,
      }),
    );
  }

  return React.createElement(React.Fragment, null, ...slots);
}) as unknown as <T>(props: ForPortalProps<T>) => React.JSX.Element | null;
