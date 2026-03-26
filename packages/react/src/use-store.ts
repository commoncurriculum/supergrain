import {
  effect as alienEffect,
  getCurrentSub,
  setCurrentSub,
  unwrap,
  getNodesIfExist,
  $TRACK,
} from "@supergrain/core";
import React, { useEffect, useLayoutEffect, useRef } from "react";

// useLayoutEffect warns during SSR. Fall back to useEffect on the server.
const useIsomorphicLayoutEffect = globalThis.document === undefined ? useEffect : useLayoutEffect;

import { tracked } from "./tracked";

interface ForProps<T> {
  each: T[];
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
  parent?: React.RefObject<Element | null>;
}

/**
 * Standard ForItem — subscribes to per-index signal and item properties.
 * Used when no parent ref is provided (O(n) React reconciliation on swap).
 */
const ForItem = tracked(
  ({
    each,
    index,
    children,
  }: {
    each: unknown[];
    index: number;
    children: (item: unknown, index: number) => React.ReactNode;
  }) => {
    const item = each[index];
    const child = children(item, index);
    return child as React.ReactElement;
  },
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * When a `parent` ref is provided, For uses O(1) direct DOM moves on swap:
 * an alien-signals effect detects element swaps and moves DOM nodes directly.
 * Children are called once with the reactive proxy item and keep their
 * original item props after swaps (since For doesn't re-render on swap).
 *
 * Without `parent`, For falls back to O(n) React keyed reconciliation.
 *
 * Both modes:
 * - Add/Remove: For re-renders to adjust slot count. React handles it.
 * - Property update: Only the affected child re-renders (via tracked).
 *
 * **Important**: When using the `parent` prop, children MUST be `tracked()`
 * components (e.g., `<Row />`). For calls children directly without a wrapper,
 * so inline children won't have reactive subscriptions for property changes.
 *
 * @example
 * ```tsx
 * // Fast path — O(1) swap (children must be tracked)
 * const tbodyRef = useRef<HTMLTableSectionElement>(null)
 * <tbody ref={tbodyRef}>
 *   <For each={store.data} parent={tbodyRef}>
 *     {(item) => <Row key={item.id} item={item} />}
 *   </For>
 * </tbody>
 *
 * // Standard path — no ref needed, inline children OK
 * <For each={store.data}>
 *   {(item) => <Row key={item.id} item={item} />}
 * </For>
 * ```
 */
// tracked() erases the generic <T>, so we cast through unknown to restore it.
export const For = tracked((props: ForProps<unknown>) => {
  const { each, children, fallback, parent } = props;
  const prevRawRef = useRef<unknown[]>([]);
  const swapCleanupRef = useRef<(() => void) | null>(null);

  // Subscribe to structural changes (ownKeys: add, remove, splice).
  void (each as any)?.[$TRACK];

  const raw = unwrap(each);

  // O(1) swap effect — only when parent ref is provided.
  // No deps array: must re-create the alien-signals effect on every For render
  // so it captures the latest `raw` array reference after structural changes.
  useIsomorphicLayoutEffect(() => {
    if (!parent) {
      return;
    }

    if (!raw || raw.length === 0) {
      swapCleanupRef.current?.();
      swapCleanupRef.current = null;
      return;
    }

    swapCleanupRef.current?.();
    prevRawRef.current = [...raw];

    const cleanup = alienEffect(() => {
      const nodes = getNodesIfExist(raw);
      for (let i = 0; i < raw.length; i++) {
        if (nodes?.[i]) {
          nodes[i]();
        } else {
          void each[i];
        }
      }

      const prev = prevRawRef.current;
      const container = parent.current;
      if (!container || prev.length !== raw.length) {
        prevRawRef.current = [...raw];
        return;
      }

      const changed: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== prev[i]) {
          changed.push(i);
          if (changed.length > 2) {
            break;
          }
        }
      }

      if (changed.length === 2) {
        const [a, b] = changed;
        const domChildren = container.children;
        const nodeA = domChildren[a];
        const nodeB = domChildren[b];
        if (nodeA && nodeB) {
          const siblingA = nodeA.nextSibling === nodeB ? nodeA : nodeA.nextSibling;
          nodeB.after(nodeA);
          if (siblingA) {
            siblingA.before(nodeB);
          } else {
            container.append(nodeB);
          }
        }
        // Update prev from raw (not swapping within prev) to preserve
        // object identity — raw may contain proxy wrappers while prev
        // has raw objects, so we must copy from raw for === to work.
        prev[a] = raw[a];
        prev[b] = raw[b];
      } else {
        prevRawRef.current = [...raw];
      }
    });

    swapCleanupRef.current = cleanup;
    return () => {
      cleanup();
      swapCleanupRef.current = null;
    };
  });

  const elementCacheRef = useRef(new Map<unknown, React.ReactNode>());

  if (!raw || raw.length === 0) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }
  const slots: React.ReactNode[] = Array.from({ length: raw.length });

  if (parent) {
    // Parent path (O(1) swap): call children directly with untracked array reads.
    // No wrapper component needed — children (e.g., tracked Row) handle their own
    // subscriptions. After a swap, For doesn't re-render, so children keep their
    // original item props. The swap effect moves DOM nodes to match.
    const prevSub = getCurrentSub();
    setCurrentSub(undefined); // untrack array reads to avoid subscribing For to per-index signals
    const prevCache = elementCacheRef.current;
    const nextCache = new Map<unknown, React.ReactNode>();
    for (let i = 0; i < raw.length; i++) {
      const rawItem = raw[i];
      const cached = prevCache.get(rawItem);
      // Intentionally using === undefined (not .has()) — children() returns JSX elements,
      // never undefined. Avoiding the extra Map lookup keeps this hot loop fast.
      if (cached === undefined) {
        slots[i] = children(each[i], i);
      } else {
        slots[i] = cached;
      }
      nextCache.set(rawItem, slots[i]);
    }
    elementCacheRef.current = nextCache;
    setCurrentSub(prevSub);
  } else {
    // Non-parent path: use ForItem wrapper for per-index signal subscription
    // so React keyed reconciliation handles swaps.
    const nodes = getNodesIfExist(raw);
    for (let i = 0; i < raw.length; i++) {
      const existingNode = nodes?.[i];
      if (existingNode) {
        existingNode();
      } else {
        void each[i];
      }
    }

    for (let i = 0; i < raw.length; i++) {
      const rawItem = raw[i];
      const key =
        rawItem && typeof rawItem === "object" && "id" in rawItem
          ? ((rawItem as Record<string, unknown>).id as React.Key)
          : i;

      slots[i] = React.createElement(ForItem, {
        key,
        each,
        index: i,
        children,
      });
    }
  }

  return React.createElement(React.Fragment, null, ...slots);
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;
