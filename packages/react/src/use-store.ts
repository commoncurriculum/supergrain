import {
  effect as alienEffect,
  getCurrentSub,
  setCurrentSub,
  unwrap,
  profileTimeStart,
  profileTimeEnd,
  getNodesIfExist,
} from "@supergrain/core";
import React, { useEffect, useLayoutEffect, useRef } from "react";

import { tracked } from "./tracked";

const $TRACK = Symbol.for("supergrain:track");

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
 * Cached ForItem — caches its item in a ref for O(1) swap support.
 *
 * Only re-reads from the array when the index prop changes (structural
 * change). On property-change re-renders, uses the cached item — so it
 * always renders the correct content even if the DOM was moved by the
 * alien swap effect.
 */
const CachedForItem = tracked(
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
    const itemRef = useRef<unknown>(null);

    if (itemRef.current === null || prevIndexRef.current !== index) {
      const prevSub = getCurrentSub();
      setCurrentSub(undefined as any); // eslint-disable-line unicorn/no-useless-undefined -- intentionally clearing subscriber
      itemRef.current = each[index];
      setCurrentSub(prevSub);
      prevIndexRef.current = index;
    }

    const child = children(itemRef.current, index);
    return child as React.ReactElement;
  },
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * When a `parent` ref is provided, For uses O(1) direct DOM moves on swap:
 * an alien-signals effect detects element swaps and moves DOM nodes.
 * CachedForItem ensures label changes still render correctly after a move.
 *
 * Without `parent`, For falls back to O(n) React keyed reconciliation.
 *
 * Both modes:
 * - Add/Remove: For re-renders to adjust slot count. React handles it.
 * - Property update: Only the affected ForItem re-renders (via tracked).
 *
 * @example
 * ```tsx
 * // Fast path — O(1) swap
 * const tbodyRef = useRef<HTMLTableSectionElement>(null)
 * <tbody ref={tbodyRef}>
 *   <For each={store.data} parent={tbodyRef}>
 *     {(item) => <Row key={item.id} item={item} />}
 *   </For>
 * </tbody>
 *
 * // Standard path — no ref needed
 * <For each={store.data}>
 *   {(item) => <Row key={item.id} item={item} />}
 * </For>
 * ```
 */
// tracked() erases the generic <T>, so we cast through unknown to restore it.
export const For = tracked((props: ForProps<unknown>) => {
  profileTimeStart("forRender");
  const { each, children, fallback, parent } = props;
  const prevRawRef = useRef<unknown[]>([]);
  const swapCleanupRef = useRef<(() => void) | null>(null);

  // Subscribe to structural changes (ownKeys: add, remove, splice).
  void (each as any)?.[$TRACK];

  const raw = unwrap(each);

  // O(1) swap effect — only when parent ref is provided.
  useLayoutEffect(() => {
    if (!parent) {
      return;
    }

    if (!raw || raw.length === 0) {
      swapCleanupRef.current?.();
      swapCleanupRef.current = null;
      return;
    }

    swapCleanupRef.current?.();
    profileTimeStart("forArrayCopy");
    prevRawRef.current = [...raw];
    profileTimeEnd("forArrayCopy");

    const cleanup = alienEffect(() => {
      profileTimeStart("forSwapEffect");
      profileTimeStart("signalSubscribe");
      const nodes = getNodesIfExist(raw);
      for (let i = 0; i < raw.length; i++) {
        if (nodes?.[i]) {
          nodes[i]();
        } else {
          void each[i];
        }
      }
      profileTimeEnd("signalSubscribe");

      const prev = prevRawRef.current;
      const container = parent.current;
      if (!container || prev.length !== raw.length) {
        profileTimeStart("forArrayCopy");
        prevRawRef.current = [...raw];
        profileTimeEnd("forArrayCopy");
        profileTimeEnd("forSwapEffect");
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
      }

      profileTimeStart("forArrayCopy");
      prevRawRef.current = [...raw];
      profileTimeEnd("forArrayCopy");
      profileTimeEnd("forSwapEffect");
    });

    swapCleanupRef.current = cleanup;
    return cleanup;
  });

  useEffect(
    () => () => {
      swapCleanupRef.current?.();
    },
    [],
  );

  if (!raw || raw.length === 0) {
    profileTimeEnd("forRender");
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }

  // Without parent: subscribe to per-index signals for React reconciliation on swap.
  if (!parent) {
    const nodes = getNodesIfExist(raw);
    for (let i = 0; i < raw.length; i++) {
      const existingNode = nodes?.[i];
      if (existingNode) {
        existingNode();
      } else {
        void each[i];
      }
    }
  }

  const ItemComponent = parent ? CachedForItem : ForItem;

  profileTimeStart("forSlotBuildTime");
  const slots = Array.from({ length: raw.length });
  for (let i = 0; i < raw.length; i++) {
    const rawItem = raw[i];
    const key =
      rawItem && typeof rawItem === "object" && "id" in rawItem
        ? ((rawItem as Record<string, unknown>).id as React.Key)
        : i;

    slots[i] = React.createElement(ItemComponent, {
      key,
      each,
      index: i,
      children,
    });
  }

  profileTimeEnd("forSlotBuildTime");
  profileTimeEnd("forRender");
  return slots as any;
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;
