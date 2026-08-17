import React from "react";

import { tracked } from "./tracked";
import { useComputed } from "./use-computed";

// Symbol.for (not a local Symbol) so If still recognizes Else if the module
// gets duplicated in a bundle or crosses a package boundary.
const ELSE_MARKER = Symbol.for("supergrain.else");

type IfChild<T> = React.ReactNode | ((value: NonNullable<T>) => React.ReactNode);

interface IfProps<T> {
  when: T | (() => T);
  children: IfChild<T> | ReadonlyArray<IfChild<T>>;
}

interface ElseProps {
  children?: React.ReactNode;
}

/**
 * Marks the else branch of an `<If>`. `<If>` extracts its children and
 * renders them while the condition is falsy. Rendered anywhere else, it
 * draws nothing — it's a marker, not a real component.
 */
export function Else(_props: ElseProps): React.JSX.Element | null {
  return null;
}
(Else as unknown as Record<symbol, boolean>)[ELSE_MARKER] = true;

/**
 * Splits If's children into the then branch and the else branch. Descends
 * into arrays and fragments so `<Else>` still works when a branch is
 * wrapped in `<>...</>` or built with .map(). It does NOT descend into
 * other components — an `<Else>` hidden inside a custom wrapper component
 * can't be seen from here and would render as part of the then branch
 * (where it draws nothing).
 */
function partition(
  node: unknown,
  thenNodes: Array<unknown>,
  elseNodes: Array<React.ReactNode>,
): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      partition(child, thenNodes, elseNodes);
    }
    return;
  }
  if (React.isValidElement(node)) {
    const type = node.type as unknown;
    if (typeof type === "function" && (type as unknown as Record<symbol, unknown>)[ELSE_MARKER]) {
      elseNodes.push((node.props as ElseProps).children);
      return;
    }
    if (type === React.Fragment) {
      partition((node.props as ElseProps).children, thenNodes, elseNodes);
      return;
    }
  }
  thenNodes.push(node);
}

/**
 * Conditional rendering — the if/else of the template helpers.
 *
 * Renders its children while `when` is truthy; children wrapped in
 * `<Else>` render while it's falsy. Pass the condition as a **function**
 * so it's evaluated inside If's own tracked scope, behind a computed that
 * acts as a firewall: the component subscribes to the *truthiness* of the
 * condition, not its inputs. `store.count` going 1 → 2 re-renders
 * nothing; only a truthy ↔ falsy flip swaps the branch, and the parent
 * never re-renders. A plain (non-function) `when` value also works, but
 * is evaluated by the parent, so the parent re-renders on every change
 * to the condition's inputs.
 *
 * `<Else>` must be a direct child of `<If>` (fragments and arrays in
 * between are fine — the scanner descends through those, but not through
 * other components). Both branches' JSX is *constructed* eagerly by the
 * parent — a React rule, not a Supergrain one — so signals read inline in
 * either branch subscribe the parent. Put reactive content in `tracked()`
 * components, or use a function child.
 *
 * A function child `(value) => ...` receives the condition's (non-null)
 * value and is only called while the condition holds — use it for
 * nullable values (type narrowing, no crash while falsy). It's read in
 * If's scope, so If also re-renders when the value itself changes while
 * staying truthy (e.g. one user object replaced by another).
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
  const { when, children } = props;

  const getValue = typeof when === "function" ? (when as () => unknown) : () => when;

  // Firewall: subscribe If to the boolean result, not the condition's
  // inputs. Upstream signal changes re-run the computed, but If only
  // re-renders when the truthiness actually flips.
  const truthy = useComputed(() => Boolean(getValue()), [when]);

  const thenNodes: Array<unknown> = [];
  const elseNodes: Array<React.ReactNode> = [];
  partition(children, thenNodes, elseNodes);

  if (!truthy) {
    return elseNodes.length === 0 ? null : React.createElement(React.Fragment, null, ...elseNodes);
  }

  // Only read the condition's value (subscribing If to its inputs) when a
  // function child actually needs it — plain children keep the pure firewall.
  const hasFunctionChild = thenNodes.some((node) => typeof node === "function");
  const value = hasFunctionChild ? getValue() : undefined;
  const rendered = thenNodes.map((node) =>
    typeof node === "function"
      ? (node as (value: unknown) => React.ReactNode)(value)
      : (node as React.ReactNode),
  );
  return React.createElement(React.Fragment, null, ...rendered);
}) as unknown as <T>(props: IfProps<T>) => React.JSX.Element | null;
