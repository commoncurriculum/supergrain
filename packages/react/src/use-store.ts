import { effect as alienEffect, unwrap } from "@supergrain/core";
import React, { useLayoutEffect, useRef } from "react";

import { tracked } from "./tracked";

const $TRACK = Symbol.for("supergrain:track");
const $NODE = Symbol.for("supergrain:node");

interface ForProps<T> {
  each: T[];
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
  container?: React.RefObject<Element | null>;
}

/**
 * Internal slot component that reads a single array element reactively.
 *
 * Each ForItem subscribes to only its own per-index signal and the item's
 * property signals. On swap, the alien effect in For moves DOM nodes BEFORE
 * React renders, so ForItem's re-render is a no-op (DOM already correct).
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
    // Read through the proxy — subscribes to this index's signal
    // AND item property signals (via children's render)
    const item = each[index];
    const child = children(item, index);
    return child as React.ReactElement;
  },
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * Uses O(1) direct DOM swaps via an alien-signals effect that subscribes
 * to per-index signals and calls insertBefore when elements change position.
 * The effect fires synchronously during endBatch(), before React renders,
 * so ForItem re-renders are no-ops (DOM already correct).
 *
 * - Swap: 2 DOM moves via insertBefore. O(1).
 * - Add/Remove: For re-renders to adjust slot count. React handles it.
 * - Property update: Only the affected Row re-renders (via tracked).
 *
 * Pass a `container` ref for the parent DOM element to enable O(1) swaps.
 * Without it, For falls back to O(n) React reconciliation for swaps.
 *
 * @example
 * ```tsx
 * const tbodyRef = useRef<HTMLTableSectionElement>(null)
 * <tbody ref={tbodyRef}>
 *   <For each={store.data} container={tbodyRef}>
 *     {(item) => <Row key={item.id} item={item} />}
 *   </For>
 * </tbody>
 * ```
 */
// tracked() erases the generic <T>, so we cast through unknown to restore it.
export const For = tracked((props: ForProps<unknown>) => {
  const { each, children, fallback, container } = props;
  const prevRawRef = useRef<unknown[]>([]);

  // Subscribe to structural changes (ownKeys: add, remove, splice).
  void (each as any)?.[$TRACK];

  const raw = unwrap(each);

  // O(1) DOM swap effect — requires container ref for DOM access.
  useLayoutEffect(() => {
    if (!container || !raw || raw.length === 0) return;

    // Initialize snapshot
    prevRawRef.current = raw.slice();

    const cleanup = alienEffect(() => {
      // Subscribe to per-index signals.
      // Direct signal reads skip proxy overhead (wrapping, trackArrayVersion).
      const nodes = (raw as any)[$NODE];
      if (nodes) {
        for (let i = 0; i < raw.length; i++) {
          if (nodes[i]) nodes[i]();
        }
      }

      // Detect element identity changes
      const prev = prevRawRef.current;
      const containerEl = container.current;
      if (!containerEl || prev.length !== raw.length) {
        prevRawRef.current = raw.slice();
        return;
      }

      // Find changed indices
      const changed: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== prev[i]) {
          changed.push(i);
          if (changed.length > 2) break; // not a simple swap
        }
      }

      if (changed.length === 2) {
        const [a, b] = changed;
        const domChildren = containerEl.children;
        const nodeA = domChildren[a];
        const nodeB = domChildren[b];
        if (nodeA && nodeB) {
          // Swap two DOM nodes
          const siblingA = nodeA.nextSibling === nodeB ? nodeA : nodeA.nextSibling;
          containerEl.insertBefore(nodeA, nodeB.nextSibling);
          containerEl.insertBefore(nodeB, siblingA);
        }
      }

      prevRawRef.current = raw.slice();
    });

    return cleanup;
  }, [each, container]);

  if (!raw || raw.length === 0) {
    prevRawRef.current = [];
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }

  // Key by ID for correct React reconciliation on add/remove.
  // When container is provided, the alien effect handles swap DOM moves —
  // For does NOT subscribe to per-index signals and does NOT re-render on swap.
  // Without container, For subscribes to per-index signals and re-renders
  // on swap so React can move DOM nodes via keyed reconciliation.
  const slots = [];

  if (!container) {
    // Fallback: subscribe to per-index signals for React-based keyed reconciliation
    const nodes = (raw as any)[$NODE];
    for (let i = 0; i < raw.length; i++) {
      const existingNode = nodes?.[i];
      if (existingNode) {
        existingNode();
      } else {
        void each[i];
      }
    }
  }

  for (let i = 0; i < raw.length; i++) {
    const rawItem = raw[i];
    const key =
      rawItem && typeof rawItem === "object" && "id" in rawItem
        ? ((rawItem as Record<string, unknown>).id as React.Key)
        : i;

    slots.push(
      React.createElement(ForItem, {
        key,
        each,
        index: i,
        children,
      }),
    );
  }

  return React.createElement(React.Fragment, null, ...slots);
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;
