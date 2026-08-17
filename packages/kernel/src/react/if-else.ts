import React from "react";

import { tracked } from "./tracked";
import { useComputed } from "./use-computed";

// Symbol.for (not a local Symbol) so If still recognizes its markers if the
// module gets duplicated in a bundle or crosses a package boundary.
const ELSE_MARKER = Symbol.for("supergrain.else");
const ELSE_IF_MARKER = Symbol.for("supergrain.elseif");

type IfChild<T> = React.ReactNode | ((value: NonNullable<T>) => React.ReactNode);

interface IfProps<T> {
  when: T | (() => T);
  children: IfChild<T> | ReadonlyArray<IfChild<T>>;
}

interface ElseProps {
  children?: React.ReactNode;
}

interface ElseIfProps<T> {
  when: T | (() => T);
  children: IfChild<T> | ReadonlyArray<IfChild<T>>;
}

interface ElseIfBranch {
  when: unknown;
  nodes: ReadonlyArray<unknown>;
}

/**
 * Marks the else branch of an `<If>`. `<If>` extracts its children and
 * renders them while every condition in the chain is falsy. Rendered
 * anywhere else, it draws nothing — it's a marker, not a real component.
 */
export function Else(_props: ElseProps): React.JSX.Element | null {
  return null;
}
(Else as unknown as Record<symbol, boolean>)[ELSE_MARKER] = true;

/**
 * Marks a chained branch of an `<If>`, like Ember's `{{else if}}`. Its
 * children render when the `<If>` condition is falsy and this `when` is
 * the first truthy condition among the chain's `<ElseIf>`s (document
 * order). Like `<If>`, pass `when` as a function to keep the firewall,
 * and a function child receives this condition's non-null value.
 * Rendered outside an `<If>`, it draws nothing.
 */
export function ElseIf<T>(_props: ElseIfProps<T>): React.JSX.Element | null {
  return null;
}
(ElseIf as unknown as Record<symbol, boolean>)[ELSE_IF_MARKER] = true;

/**
 * Splits If's children into the then branch, the ElseIf branches (in
 * document order), and the else branch. Descends into arrays and
 * fragments so the markers still work when a branch is wrapped in
 * `<>...</>` or built with .map(). It does NOT descend into other
 * components — a marker hidden inside a custom wrapper component can't
 * be seen from here and would render as part of the then branch (where
 * it draws nothing).
 */
function partition(
  node: unknown,
  thenNodes: Array<unknown>,
  elseIfs: Array<ElseIfBranch>,
  elseNodes: Array<React.ReactNode>,
): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      partition(child, thenNodes, elseIfs, elseNodes);
    }
    return;
  }
  if (React.isValidElement(node)) {
    const type = node.type as unknown;
    if (typeof type === "function") {
      const markers = type as unknown as Record<symbol, unknown>;
      if (markers[ELSE_IF_MARKER]) {
        const props = node.props as ElseIfProps<unknown>;
        const kids = props.children;
        elseIfs.push({ when: props.when, nodes: Array.isArray(kids) ? kids : [kids] });
        return;
      }
      if (markers[ELSE_MARKER]) {
        elseNodes.push((node.props as ElseProps).children);
        return;
      }
    }
    if (type === React.Fragment) {
      partition((node.props as ElseProps).children, thenNodes, elseIfs, elseNodes);
      return;
    }
  }
  thenNodes.push(node);
}

function toGetter(when: unknown): () => unknown {
  return typeof when === "function" ? (when as () => unknown) : () => when;
}

/**
 * Renders one branch's nodes. Only reads the branch's condition value
 * (subscribing If to its inputs) when a function child actually needs
 * it — plain children keep the pure firewall. An optional `key` puts the
 * branch in a keyed fragment so presence wrappers (AnimatedIf) can tell
 * branches apart.
 */
function renderBranch(
  nodes: ReadonlyArray<unknown>,
  getValue: () => unknown,
  key?: string,
): React.JSX.Element {
  const hasFunctionChild = nodes.some((node) => typeof node === "function");
  const value = hasFunctionChild ? getValue() : undefined;
  const rendered = nodes.map((node) =>
    typeof node === "function"
      ? (node as (value: unknown) => React.ReactNode)(value)
      : (node as React.ReactNode),
  );
  return React.createElement(React.Fragment, key === undefined ? null : { key }, ...rendered);
}

interface BranchState {
  activeIndex: number;
  thenNodes: ReadonlyArray<unknown>;
  elseIfs: ReadonlyArray<ElseIfBranch>;
  elseNodes: ReadonlyArray<React.ReactNode>;
  getValue: () => unknown;
}

/**
 * Shared body of If and AnimatedIf: partitions the children and derives
 * the active branch behind the computed firewall — the component
 * subscribes to the index of the first truthy condition (0 = then,
 * 1.. = ElseIfs, -1 = else), not the conditions' inputs. Upstream signal
 * changes re-run the computed, but the component only re-renders when
 * the active branch actually changes. The computed stops at the first
 * truthy condition, so later conditions in the chain aren't even
 * subscribed to until every earlier one goes falsy.
 */
function useBranchState(props: IfProps<unknown>): BranchState {
  const { when, children } = props;

  const getValue = toGetter(when);

  const thenNodes: Array<unknown> = [];
  const elseIfs: Array<ElseIfBranch> = [];
  const elseNodes: Array<React.ReactNode> = [];
  partition(children, thenNodes, elseIfs, elseNodes);

  // Effect-driven re-renders reuse the same props object, so `children`
  // is a stable dep there; it only changes (recreating the computed with
  // the current branch list) when the parent re-renders with fresh JSX.
  const activeIndex = useComputed(() => {
    if (getValue()) {
      return 0;
    }
    for (let i = 0; i < elseIfs.length; i++) {
      if (toGetter(elseIfs[i]!.when)()) {
        return i + 1;
      }
    }
    return -1;
  }, [when, children]);

  return { activeIndex, thenNodes, elseIfs, elseNodes, getValue };
}

/**
 * Conditional rendering — the if/else of the template helpers.
 *
 * Renders its children while `when` is truthy; `<ElseIf when={...}>`
 * children render when it's falsy and theirs is the first truthy
 * condition in the chain; children wrapped in `<Else>` render while
 * everything is falsy. Pass conditions as **functions** so they're
 * evaluated inside If's own tracked scope, behind a computed that acts
 * as a firewall: the component subscribes to *which branch is active*,
 * not the conditions' inputs. `store.count` going 1 → 2 re-renders
 * nothing; only a change of active branch swaps content, and the parent
 * never re-renders. Chains short-circuit like real if/else if: while an
 * earlier condition holds, later conditions aren't evaluated — or even
 * subscribed to. A plain (non-function) `when` value also works, but is
 * evaluated by the parent, so the parent re-renders on every change to
 * the condition's inputs.
 *
 * `<ElseIf>` and `<Else>` must be direct children of `<If>` (fragments
 * and arrays in between are fine — the scanner descends through those,
 * but not through other components). Every branch's JSX is *constructed*
 * eagerly by the parent — a React rule, not a Supergrain one — so
 * signals read inline in any branch subscribe the parent. Put reactive
 * content in `tracked()` components, or use a function child.
 *
 * A function child `(value) => ...` receives its own branch's condition
 * value (non-null) and is only called while that branch is active — use
 * it for nullable values (type narrowing, no crash while falsy). It's
 * read in If's scope, so If also re-renders when the value itself
 * changes while staying truthy (e.g. one user object replaced by
 * another).
 *
 * @example
 * ```tsx
 * // Boolean gate — parent never re-renders, If only on empty ↔ non-empty
 * <If when={() => store.todos.length > 0}>
 *   <TodoList />
 *   <Else>
 *     <EmptyState />
 *   </Else>
 * </If>
 *
 * // Chain — first truthy branch wins, like if / else if / else
 * <If when={() => store.status === "loading"}>
 *   <Spinner />
 *   <ElseIf when={() => store.status === "error"}>
 *     <ErrorPane />
 *   </ElseIf>
 *   <Else>
 *     <Content />
 *   </Else>
 * </If>
 *
 * // Function child — receives the narrowed, non-null value
 * <If when={() => store.currentUser}>
 *   {(user) => <Avatar name={user.name} />}
 *   <Else>
 *     <LoginButton />
 *   </Else>
 * </If>
 * ```
 */
// tracked() erases the generic <T>, so we cast through unknown to restore it.
export const If = tracked((props: IfProps<unknown>) => {
  const { activeIndex, thenNodes, elseIfs, elseNodes, getValue } = useBranchState(props);

  if (activeIndex === 0) {
    return renderBranch(thenNodes, getValue);
  }
  if (activeIndex > 0) {
    const branch = elseIfs[activeIndex - 1]!;
    return renderBranch(branch.nodes, toGetter(branch.when));
  }
  return elseNodes.length === 0 ? null : React.createElement(React.Fragment, null, ...elseNodes);
}) as unknown as <T>(props: IfProps<T>) => React.JSX.Element | null;

/**
 * Creates an `<AnimatedIf>` — an `<If>` whose branch swaps run through a
 * presence wrapper (e.g. Motion's `<AnimatePresence>`) so exits animate
 * instead of unmounting instantly.
 *
 * Presence wrappers detect swaps by diffing their **direct children**
 * across their **own re-renders** — and the firewall means the parent of
 * a plain `<If>` never re-renders on a flip, so wrapping `<If>` in
 * `<AnimatePresence>` from outside can never animate. AnimatedIf inverts
 * the nesting: it renders the wrapper itself, and since AnimatedIf is
 * exactly the component that re-renders on branch changes, the wrapper
 * sees every swap as a keyed direct-child change. Each branch is handed
 * over in a fragment keyed by branch (`sg-then`, `sg-elseif-0`…,
 * `sg-else`), so branch roots don't need keys of their own, and the
 * wrapper stays mounted when no branch matches (receiving `null`
 * children) so the last branch can still animate out.
 *
 * Call it once at module scope with your wrapper — the kernel has no
 * dependency on any animation library:
 *
 * @example
 * ```tsx
 * // animated-if.ts — once in your app
 * import { AnimatePresence } from "motion/react";
 * import { createAnimatedIf } from "@supergrain/kernel/react";
 *
 * export const AnimatedIf = createAnimatedIf((children) => (
 *   <AnimatePresence mode="wait">{children}</AnimatePresence>
 * ));
 *
 * // anywhere — same API as <If>, branches animate in and out
 * <AnimatedIf when={() => store.open}>
 *   <motion.div exit={{ opacity: 0 }}>panel</motion.div>
 *   <Else>
 *     <motion.div exit={{ opacity: 0 }}>teaser</motion.div>
 *   </Else>
 * </AnimatedIf>
 * ```
 */
export function createAnimatedIf(
  wrap: (children: React.ReactNode) => React.ReactNode,
): <T>(props: IfProps<T>) => React.JSX.Element | null {
  return tracked((props: IfProps<unknown>) => {
    const state = useBranchState(props);
    return React.createElement(React.Fragment, null, wrap(renderActiveBranch(state)));
  }) as unknown as <T>(props: IfProps<T>) => React.JSX.Element | null;
}

/** The active branch as branch-keyed content for AnimatedIf's wrapper. */
function renderActiveBranch(state: BranchState): React.ReactNode {
  const { activeIndex, thenNodes, elseIfs, elseNodes, getValue } = state;
  if (activeIndex === 0) {
    return renderBranch(thenNodes, getValue, "sg-then");
  }
  if (activeIndex > 0) {
    const branch = elseIfs[activeIndex - 1]!;
    return renderBranch(branch.nodes, toGetter(branch.when), `sg-elseif-${activeIndex - 1}`);
  }
  if (elseNodes.length === 0) {
    // Undefined children keep the wrapper mounted — it must outlive the
    // branch to run the exit animation.
    return undefined;
  }
  return React.createElement(React.Fragment, { key: "sg-else" }, ...elseNodes);
}
