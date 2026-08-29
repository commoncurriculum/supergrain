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
  HOOK_NAME = /^use[A-Z]/u,
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

/** Any node, reachable upwards. `Program` is the root and its parent is null. */
interface Linked {
  type: string;
  parent: Linked | null;
}

function isFunction(node: Linked): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

/** The function that renders this node, or undefined at module scope. */
function enclosingFunction(node: Linked): FunctionNode | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunction(current)) return current as unknown as FunctionNode;
  }
  return undefined;
}

/**
 * True when a `tracked()` call wraps this function, at any wrapper depth.
 *
 * Walking stops at the first non-call ancestor, which is the binding. That is
 * what makes `memo(tracked(fn))` and `tracked(memo(fn))` both read as tracked
 * without either nesting order being special-cased.
 */
function isTracked(fn: Linked, isTrackedCallee: (name: string) => boolean): boolean {
  for (let at = fn.parent; at?.type === "CallExpression"; at = at.parent) {
    const { callee } = at as unknown as ESTree.CallExpression;
    if (callee.type === "Identifier" && isTrackedCallee(callee.name)) return true;
  }
  return false;
}

/**
 * The identifier this function is bound to, seen through any wrapper calls.
 *
 * Undefined when there is no such binding — a `<For>` child callback, an
 * argument, a destructured target — which is exactly the set of functions
 * that are not components.
 */
function bindingIdOf(fn: Linked): ESTree.BindingIdentifier | undefined {
  let at = fn.parent;
  while (at?.type === "CallExpression") at = at.parent;
  if (at?.type !== "VariableDeclarator") return undefined;

  const { id } = at as unknown as ESTree.VariableDeclarator;
  return id.type === "Identifier" ? id : undefined;
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
      const fn = enclosingFunction(node as unknown as Linked);
      if (fn) renders.add(fn);
    }

    function recordReactiveRead(node: ESTree.CallExpression): void {
      const fn = enclosingFunction(node as unknown as Linked);
      if (fn) readsReactiveState.add(fn);
    }

    function reportIfUntracked(fn: FunctionNode): void {
      if (onlyReactive && !readsReactiveState.has(fn)) return;

      const id = fn.type === "FunctionDeclaration" ? fn.id : bindingIdOf(fn as unknown as Linked);
      if (!id) return;
      if (!COMPONENT_NAME.test(id.name) || HOOK_NAME.test(id.name)) return;
      if (isTracked(fn as unknown as Linked, isTrackedCallee)) return;

      context.report({
        node: id as unknown as ESTree.Node,
        messageId: "untracked",
        data: { name: id.name },
      });
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
