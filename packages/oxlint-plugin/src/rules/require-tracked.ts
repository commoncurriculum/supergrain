import { defineRule, type ESTree } from "@oxlint/plugins";

import { calleeName, createImportTracker } from "../imports.js";

/**
 * A component that isn't wrapped in `tracked()` subscribes to nothing.
 *
 * It still re-renders when a parent does, which is what makes this dangerous:
 * it usually looks fine, until the parent stops re-rendering and the child
 * silently shows stale data. No type error, no exception, no failing test.
 * `packages/kernel/tests/skill-claims/kernel.test.tsx` pins both halves.
 *
 * The default is deliberately strict — every component, not just ones we can
 * prove read reactive state. Proving it requires knowing which locals are
 * reactive, which is exactly what a linter without type information cannot do
 * reliably, and a miss here is a silent bug. Wrapping a purely presentational
 * component costs a negligible wrapper. Set `onlyReactive` to trade that
 * safety for quiet.
 *
 * Rather than hunt for component declarations and then search each one for
 * JSX, this works the other way round: JSX announces itself, and the AST's
 * `parent` links say which function rendered it. That means no tree walking,
 * and the awkward cases fall out for free — the child callback of
 * `<For each={rows}>{(r) => <Row />}</For>` resolves to the callback, which
 * has no component name, so it is skipped without a special case.
 */

const COMPONENT_NAME = /^[A-Z]/u,
  /** Hooks whose presence proves the component touches reactive state. */
  REACTIVE_HOOKS = new Set([
    "useReactive",
    "useComputed",
    "useSignalEffect",
    "useResource",
    "useReactivePromise",
    "useReactiveTask",
    "useDocument",
    "useQuery",
    "useDocumentStore",
  ]);

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

function isFunction(node: ESTree.Node): node is FunctionNode {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

/** The function that renders this node, or undefined at module scope. */
function enclosingFunction(node: ESTree.Node): FunctionNode | undefined {
  for (let current: ESTree.Node | null = node.parent; current; current = current.parent) {
    if (isFunction(current)) return current;
  }
  return undefined;
}

/**
 * The name this function is bound to and whether a `tracked()` call wraps it.
 *
 * Both answers come from the same walk outwards through wrapper calls, because
 * they are two readings of one chain: `memo(tracked(Row))` has to yield the
 * name `Row` and "tracked" together. Walking stops at the first non-call
 * ancestor — the binding — which is what makes `memo(tracked(fn))` and
 * `tracked(memo(fn))` both read as tracked without either order being
 * special-cased.
 *
 * A null `id` means there is no binding to name — a `<For>` child callback, an
 * argument, a destructured target — which is exactly the set of functions that
 * are not components.
 */
function resolveComponent(
  fn: FunctionNode,
  isTrackedCallee: (name: string) => boolean,
): { id: ESTree.BindingIdentifier | null; tracked: boolean } {
  /* A function declaration carries its own name and cannot be wrapped in a
     call, so the walk below has nothing to find. */
  if (fn.type === "FunctionDeclaration") return { id: fn.id, tracked: false };

  let at: ESTree.Node | null = fn.parent,
    tracked = false;
  for (; at?.type === "CallExpression"; at = at.parent) {
    const { callee } = at;
    if (callee.type === "Identifier" && isTrackedCallee(callee.name)) tracked = true;
  }

  const id = at?.type === "VariableDeclarator" && at.id.type === "Identifier" ? at.id : null;
  return { id, tracked };
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Require React components to be wrapped in `tracked()`",
    },
    messages: {
      untracked:
        "`{{name}}` is not wrapped in `tracked()`, so its own reads subscribe to nothing — it re-renders only when a parent happens to. Wrap it: `const {{name}} = tracked(…)`.",
    },
    schema: [
      {
        type: "object",
        properties: {
          onlyReactive: {
            type: "boolean",
            description:
              "Only flag components that call a known reactive hook. Quieter, but misses components made reactive through props.",
          },
          storeHooks: {
            type: "array",
            items: { type: "string" },
            description:
              "Extra hook names that read reactive state, e.g. the `useStore` returned by `createStoreContext()` in your own module.",
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ onlyReactive: false, storeHooks: [] }],
  },

  create(context) {
    /**
     * `meta.defaultOptions` is merged under whatever the user supplies, so both
     * keys are always present. Defaulting them again here would only hide it if
     * that ever stopped being true.
     */
    const { onlyReactive, storeHooks } = context.options[0] as {
        onlyReactive: boolean;
        storeHooks: Array<string>;
      },
      imports = createImportTracker(),
      isTrackedCallee = (name: string) => imports.isImported(name, "tracked"),
      reactiveHooks = new Set([...REACTIVE_HOOKS, ...storeHooks]),
      /** Functions that rendered JSX, and those that called a reactive hook. */
      readsReactiveState = new Set<FunctionNode>(),
      renders = new Set<FunctionNode>();

    function recordJsx(node: ESTree.JSXElement | ESTree.JSXFragment): void {
      const fn = enclosingFunction(node);
      if (fn) renders.add(fn);
    }

    function recordReactiveRead(node: ESTree.CallExpression): void {
      const fn = enclosingFunction(node);
      if (fn) readsReactiveState.add(fn);
    }

    function reportIfUntracked(fn: FunctionNode): void {
      if (onlyReactive && !readsReactiveState.has(fn)) return;

      const { id, tracked } = resolveComponent(fn, isTrackedCallee);
      // A hook name cannot reach here: `useFoo` fails the component test.
      if (!id || !COMPONENT_NAME.test(id.name) || tracked) return;

      context.report({ node: id, messageId: "untracked", data: { name: id.name } });
    }

    return {
      ImportDeclaration(node) {
        imports.visitImport(node);
      },

      JSXElement: recordJsx,
      JSXFragment: recordJsx,

      CallExpression(node) {
        const name = calleeName(node);
        if (!name || !reactiveHooks.has(name)) return;
        recordReactiveRead(node);
      },

      /**
       * Reported at the end: a component's hooks and its JSX can appear in
       * either order, and both feed the decision.
       */
      "Program:exit"() {
        for (const fn of renders) reportIfUntracked(fn);
      },
    };
  },
});
