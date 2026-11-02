import { effect, unwrap, $TRACK } from "@supergrain/kernel";
import { setActiveSub, trackArrayElements, type ReactiveTagged } from "@supergrain/kernel/internal";
import React, { useEffect, useLayoutEffect, useReducer, useRef } from "react";

import { tracked } from "./tracked";

/* c8 ignore start -- the React project runs in a browser; this branch is for SSR consumers */
const useIsomorphicLayoutEffect = globalThis.document === undefined ? useEffect : useLayoutEffect;
/* c8 ignore stop */

type Children = (item: unknown, index: number) => React.ReactNode;
/** Parent mode: the element `children` returned for each raw item. */
type Elements = Map<unknown, React.ReactNode>;

interface ForProps<T> {
  each: ReadonlyArray<T>;
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
  ({ item, index, children }: { item: unknown; index: number; children: Children }) =>
    children(item, index),
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * `For` re-renders when the list itself changes: an item added, removed,
 * replaced or moved. It never re-renders for a change inside an item; the
 * row that reads that field does. Rows are keyed by item (`item.id`, or the
 * object itself for items without one, or the index for primitives), so when
 * items shift — say one leaves the top of a sorted list — the rows that only
 * moved keep their components.
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
  const [, rerender] = useReducer(increment, 0);
  const stateRef = useRef<ForState | null>(null);
  const state: ForState = (stateRef.current ??= { elements: new Map(), shown: [], swaps: [] });
  // React still has the rows in the order of its last render: put back the
  // nodes the effect below swapped since, before React places them again.
  if (state.swaps.length > 0) undoSwaps(state, parent?.current);

  // Structure (push, splice, length, a new array) always re-renders `For`.
  void (each as ReactiveTagged)?.[$TRACK];
  const raw = unwrap(each);
  // Without `parent`, so does replacing an item in place. With `parent`, the
  // effect below decides: a swap moves DOM nodes, anything else re-renders.
  if (!parent && raw) trackArrayElements(raw);

  useIsomorphicLayoutEffect(() => {
    // The items in the order the DOM shows them. A swap updates it in place;
    // any other change re-renders `For`, which runs this effect again.
    const { shown } = state;
    if (!parent || !raw || raw.length === 0) {
      shown.length = 0;
      return;
    }
    shown.length = raw.length;
    for (let i = 0; i < raw.length; i++) shown[i] = raw[i];
    return effect(() => {
      trackArrayElements(raw);
      // A length change already re-renders `For`.
      if (raw.length !== shown.length) return;
      // The first two slots whose item changed, comparing raw objects (an
      // assigned element may be stored as a proxy). A third means no swap.
      let a = -1;
      let b = -1;
      for (let i = 0; i < raw.length; i++) {
        if (unwrap(raw[i]) !== unwrap(shown[i])) {
          if (a === -1) a = i;
          else if (b === -1) b = i;
          else {
            rerender();
            return;
          }
        }
      }
      if (a === -1) return;
      const container = parent.current;
      // DOM node i shows item i only when the array has no holes (a hole
      // renders nothing), so only then can a swap move nodes by index.
      if (
        b === -1 ||
        !container ||
        container.children.length !== raw.length ||
        unwrap(raw[a]) !== unwrap(shown[b]) ||
        unwrap(raw[b]) !== unwrap(shown[a])
      ) {
        rerender();
        return;
      }
      swapNodes(container, a, b);
      shown[a] = raw[a];
      shown[b] = raw[b];
      state.swaps.push(a, b);
    });
  });

  if (!raw || raw.length === 0) {
    // Drop the last rows' elements, so a cleared list holds nothing.
    state.elements.clear();
    return fallback ?? null;
  }

  // Item reads below are untracked: `For` already follows the array as a
  // whole, and per-index subscriptions would only add N links.
  const outer = setActiveSub(undefined);
  try {
    return parent ? reusedElements(raw, each, children, state) : rowComponents(raw, each, children);
  } finally {
    setActiveSub(outer);
  }
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;

const increment = (n: number): number => n + 1;

/** What a `For` keeps between renders, so a render allocates no more than it must. */
interface ForState {
  /** Parent mode: the element `children` returned for each raw item. */
  elements: Elements;
  /** Parent mode: the items in the order the DOM shows them. */
  shown: Array<unknown>;
  /** Parent mode: the slots swapped by moving nodes since React last rendered, in pairs. */
  swaps: Array<number>;
}

/** Swap the nodes at `a` and `b` (`a` before `b`). Its own inverse. */
function swapNodes(container: Element, a: number, b: number): void {
  const nodeA = container.children[a]!;
  const nodeB = container.children[b]!;
  const siblingA = nodeA.nextSibling === nodeB ? nodeA : nodeA.nextSibling!;
  nodeB.after(nodeA);
  siblingA.before(nodeB);
}

/** Undo the swaps, latest first, in the DOM and in `shown`. */
function undoSwaps(state: ForState, container: Element | null | undefined): void {
  const { swaps, shown } = state;
  for (let i = swaps.length - 2; i >= 0; i -= 2) {
    const a = swaps[i]!;
    const b = swaps[i + 1]!;
    if (container) swapNodes(container, a, b);
    const item = shown[a];
    shown[a] = shown[b];
    shown[b] = item;
  }
  swaps.length = 0;
}

/**
 * Parent mode: `children(item)` once per item, reused for as long as the item
 * stays in the list, so React skips rows whose element didn't change.
 */
function reusedElements(
  raw: ReadonlyArray<unknown>,
  each: ReadonlyArray<unknown>,
  children: Children,
  state: ForState,
): Array<React.ReactNode> {
  const previous = state.elements;
  // A new map, not the old one cleared: clearing a map allocates a new table
  // anyway, and the old one is read while this one fills.
  const next: Elements = new Map();
  const slots = new Array<React.ReactNode>(raw.length); // eslint-disable-line unicorn/no-new-array -- sized once, holes kept where `raw` has them
  for (let i = 0; i < raw.length; i++) {
    if (!isHole(raw, i)) {
      const rawItem = unwrap(raw[i]);
      const element = previous.get(rawItem) ?? children(each[i], i);
      next.set(rawItem, element);
      slots[i] = element;
    }
  }
  state.elements = next;
  return slots;
}

// Keys `rowComponents` has given out. Reused across calls, since a call never
// runs user code and so can't re-enter.
const usedKeys = new Set<string>();

/** Without `parent`: one `ForItem` per item, keyed by item. */
function rowComponents(
  raw: ReadonlyArray<unknown>,
  each: ReadonlyArray<unknown>,
  children: Children,
): Array<React.ReactNode> {
  // A row's index changes whenever an item above it is added or removed.
  // Pass it only when `children` declares an index parameter, so that
  // `(item) => …` rows that merely moved skip re-rendering. (A defaulted
  // index, `(item, i = 0) => …`, doesn't count as declared: write
  // `(item, i) => …`.)
  const passIndex = children.length !== 1;
  const slots = new Array<React.ReactNode>(raw.length); // eslint-disable-line unicorn/no-new-array -- sized once, holes kept where `raw` has them
  for (let i = 0; i < raw.length; i++) {
    if (!isHole(raw, i)) {
      let key = keyOf(unwrap(raw[i]), i);
      // The same key twice: key the repeat by position.
      if (usedKeys.has(key)) key = positionKey(i);
      usedKeys.add(key);
      slots[i] = React.createElement(ForItem, {
        key,
        item: each[i],
        index: passIndex ? i : 0,
        children,
      });
    }
  }
  usedKeys.clear();
  return slots;
}

/** A hole renders nothing, as with `Array.prototype.map`. */
function isHole(raw: ReadonlyArray<unknown>, i: number): boolean {
  return raw[i] === undefined && !(i in raw);
}

// Keys for objects without an `id`, by identity, so a row keeps its
// component when it moves (say a mapped row that keeps its object).
const objectKeys = new WeakMap<object, string>();
let nextObjectKey = 0;

/**
 * The item's key as React reads it, a string: `item.id` (a string or
 * number), else the object's identity, else (for a primitive) the position.
 * React compares keys as strings, so id 1 and id "1" are the same key.
 */
function keyOf(rawItem: unknown, index: number): string {
  if (!rawItem || typeof rawItem !== "object") return positionKey(index);
  const { id } = rawItem as { id?: unknown };
  if (typeof id === "string" || typeof id === "number") return String(id);
  let key = objectKeys.get(rawItem);
  if (key === undefined) {
    key = `\u0000o${nextObjectKey++}`;
    objectKeys.set(rawItem, key);
  }
  return key;
}

/** A key by position, which no id can collide with. */
function positionKey(index: number): string {
  return `\u0000${index}`;
}
