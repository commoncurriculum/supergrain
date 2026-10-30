import { effect, unwrap, $TRACK } from "@supergrain/kernel";
import { setActiveSub, trackArrayElements, type ReactiveTagged } from "@supergrain/kernel/internal";
import React, { useEffect, useLayoutEffect, useReducer, useRef } from "react";

/* c8 ignore start -- the React project runs in a browser; this branch is for SSR consumers */
const useIsomorphicLayoutEffect = globalThis.document === undefined ? useEffect : useLayoutEffect;
/* c8 ignore stop */

import { tracked } from "./tracked";

interface ForProps<T> {
  each: Array<T>;
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
  parent?: React.RefObject<Element | null>;
}

/**
 * One row without `parent`: a tracked boundary around `children(item)`, so
 * inline children (`{(todo) => <li>{todo.text}</li>}`) re-render on their own
 * when a field they read changes. Keyed by the item, so a row that only moved
 * keeps its component; it re-renders only if `children` takes the index.
 */
const ForItem = tracked(
  ({
    item,
    index,
    children,
  }: {
    item: unknown;
    index: number;
    children: (item: unknown, index: number) => React.ReactNode;
  }) => children(item, index) as React.ReactElement,
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * `For` re-renders when the list itself changes: an item added, removed,
 * replaced or moved. It never re-renders for a change inside an item; the
 * row that reads that field does. Rows are keyed by item (`item.id`, or the
 * index for items without one), so when items shift — say one leaves the
 * top of a sorted list — the rows that only moved keep their components.
 *
 * With a `parent` ref, swapping two items moves their two DOM nodes directly,
 * with no React render at all. Any other change re-renders `For` as usual.
 * In this mode `children` is called once per item and its result is reused,
 * so children MUST be `tracked()` components (e.g. `<Row />`) to update when
 * an item's fields change.
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
export const For = tracked((props: ForProps<unknown>) => {
  const { each, children, fallback, parent } = props;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Parent mode: the items as the DOM last showed them, and the element
  // `children` returned for each item.
  const shownRef = useRef<Array<unknown>>([]);
  const elementsRef = useRef(new Map<unknown, React.ReactNode>());

  // Structure (push, splice, length, a new array) always re-renders `For`.
  void (each as ReactiveTagged)?.[$TRACK];
  const raw = unwrap(each);
  // Without `parent`, so does replacing an item in place. With `parent`, the
  // effect below decides: a swap moves DOM nodes, anything else re-renders.
  if (!parent && raw) trackArrayElements(raw);

  useIsomorphicLayoutEffect(() => {
    if (!parent || !raw || raw.length === 0) return;
    shownRef.current = [...raw];
    return effect(() => {
      trackArrayElements(raw);
      const shown = shownRef.current;
      const swap = findSwap(shown, raw);
      if (swap === undefined) return; // nothing replaced since the last render
      const container = parent.current;
      if (swap === null || !container) {
        rerender();
        return;
      }
      const [a, b] = swap;
      const nodeA = container.children[a]!;
      const nodeB = container.children[b]!;
      const siblingA = nodeA.nextSibling === nodeB ? nodeA : nodeA.nextSibling!;
      nodeB.after(nodeA);
      siblingA.before(nodeB);
      shown[a] = raw[a];
      shown[b] = raw[b];
    });
  });

  if (!raw || raw.length === 0) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }

  // Item reads below are untracked: `For` already follows the array as a
  // whole, and per-index subscriptions would only add N links.
  const slots: Array<React.ReactNode> = Array.from({ length: raw.length });
  const prevSub = setActiveSub(undefined);
  try {
    if (parent) {
      const previous = elementsRef.current;
      const next = new Map<unknown, React.ReactNode>();
      for (let i = 0; i < raw.length; i++) {
        const rawItem = raw[i];
        slots[i] = previous.get(rawItem) ?? children(each[i], i);
        next.set(rawItem, slots[i]);
      }
      elementsRef.current = next;
    } else {
      // A row's index changes whenever an item above it is added or removed.
      // Pass it only when `children` declares an index parameter, so that
      // `(item) => …` rows that merely moved skip re-rendering. (A defaulted
      // index, `(item, i = 0) => …`, doesn't count as declared: write
      // `(item, i) => …`.)
      const passIndex = children.length !== 1;
      for (let i = 0; i < raw.length; i++) {
        slots[i] = React.createElement(ForItem, {
          key: keyOf(raw[i], i),
          item: each[i],
          index: passIndex ? i : 0,
          children,
        });
      }
    }
  } finally {
    setActiveSub(prevSub);
  }

  return React.createElement(React.Fragment, null, ...slots);
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;

/**
 * How `next` differs from `shown`, which has the same length or `next` would
 * have re-rendered `For`: `undefined` if no slot differs, the two indices if
 * exactly two items traded places, otherwise `null`.
 */
function findSwap(
  shown: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
): readonly [number, number] | null | undefined {
  if (shown.length !== next.length) return null;
  const changed: Array<number> = [];
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== shown[i] && changed.push(i) > 2) return null;
  }
  if (changed.length === 0) return undefined;
  if (changed.length === 1) return null;
  const [a, b] = changed as [number, number];
  return next[a] === shown[b] && next[b] === shown[a] ? [a, b] : null;
}

function keyOf(rawItem: unknown, index: number): React.Key {
  return rawItem && typeof rawItem === "object" && "id" in rawItem
    ? (rawItem as { id: React.Key }).id
    : index;
}
