import {
  effect,
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

    const cleanup = effect(() => {
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
        // Update prev from raw (not swapping within prev) to preserve
        // object identity — raw may contain proxy wrappers while prev
        // has raw objects, so we must copy from raw for === to work.
        prev[a] = raw[a];
        prev[b] = raw[b];
      } else {
        profileTimeStart("forArrayCopy");
        prevRawRef.current = [...raw];
        profileTimeEnd("forArrayCopy");
      }
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

  profileTimeStart("forSlotBuildTime");
  const slots = Array.from({ length: raw.length });

  if (parent) {
    // Parent path (O(1) swap): call children directly with untracked array reads.
    // No wrapper component needed — children (e.g., tracked Row) handle their own
    // subscriptions. After a swap, For doesn't re-render, so children keep their
    // original item props. The swap effect moves DOM nodes to match.
    const prevSub = getCurrentSub();
    setCurrentSub(undefined as any); // eslint-disable-line unicorn/no-useless-undefined -- untrack array reads to avoid subscribing For to per-index signals
    try {
      for (let i = 0; i < raw.length; i++) {
        slots[i] = children(each[i], i);
      }
    } finally {
      setCurrentSub(prevSub);
    }
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

  profileTimeEnd("forSlotBuildTime");
  profileTimeEnd("forRender");
  return slots as any;
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;
