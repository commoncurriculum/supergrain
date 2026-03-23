import { unwrap } from "@supergrain/core";
import React, { useRef } from "react";

import { tracked } from "./tracked";

const $TRACK = Symbol.for("supergrain:track");

interface ForProps<T> {
  each: T[];
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Internal slot component that reads a single array element reactively.
 *
 * Each ForItem subscribes to only its own per-index signal. On an element
 * swap, only the ForItems at swapped indices re-render — the parent For
 * and all other ForItems stay untouched.
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
    // Read through the proxy — subscribes to this index's signal only
    const item = each[index];
    const child = children(item, index);
    return child as React.ReactElement;
  },
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * For subscribes only to structural changes (ownKeys: add, remove, splice).
 * Each element is rendered through an internal ForItem tracked component
 * that subscribes to its own per-index signal. This means:
 *
 * - Swap: Only 2 ForItems re-render (O(1) instead of O(n))
 * - Add/Remove: For re-renders to adjust the slot count
 * - Property update: Only the affected Row re-renders (via tracked)
 *
 * @example
 * ```tsx
 * <For each={store.data}>
 *   {(item) => <Row key={item.id} item={item} />}
 * </For>
 * ```
 */
// tracked() erases the generic <T>, so we cast through unknown to restore it.
export const For = tracked((props: ForProps<unknown>) => {
  const { each, children, fallback } = props;

  // Subscribe to structural changes only (ownKeys), not per-element signals.
  // Access $TRACK to establish the ownKeys subscription without reading elements.
  void (each as any)?.[$TRACK];

  const raw = unwrap(each);

  if (!raw || raw.length === 0) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }

  // Build slot list from raw array (no per-index signal subscriptions).
  // Keys come from raw item IDs for correct React reconciliation on add/remove.
  const slots = [];
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
