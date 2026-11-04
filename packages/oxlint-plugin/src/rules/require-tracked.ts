import type { Context, ESTree, Options, Rule, Scope } from "@oxlint/plugins";

import { calleeName, createImportTracker, readImportSources } from "../imports.js";
import { IMPORT_SOURCES_SCHEMA, optionsObject, stringArray } from "../options.js";

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
  /** Supergrain exports that return reactive hooks: `const { useStore } = createStoreContext()`. */
  FACTORIES = new Set(["createStoreContext", "createDocumentStoreContext"]),
  /**
   * Supergrain hooks whose presence proves the component touches reactive
   * state. Matched against the import tracker, not by bare name — plenty of
   * libraries ship a `useQuery`. The silo hooks are never exported directly
   * (`createDocumentStoreContext()` returns them), so they match when a
   * configured `importSources` barrel re-exports them, or when destructured
   * from that factory in the same file — see `FACTORIES`.
   */
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
  ]),
  /**
   * Wrappers walked through by name to find the binding: React's own (bare or
   * as `React.memo`), plus a `tracked` that is not traced to supergrain — so a
   * project's own `tracked`, or one re-exported from a barrel missing from
   * `importSources`, is reported as untracked rather than silently skipped.
   */
  WRAPPERS = new Set(["memo", "forwardRef", "tracked"]);

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

/** What `require-tracked` reads from its options. */
interface RequireTrackedOptions {
  onlyReactive: boolean;
  storeHooks: Array<string>;
  importSources: Array<string>;
}

function readOptions(options: Readonly<Options>): RequireTrackedOptions {
  const raw = optionsObject(options);
  return {
    onlyReactive: raw.onlyReactive === true,
    storeHooks: stringArray(raw.storeHooks, []),
    importSources: readImportSources(options),
  };
}

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

function isWrapper(callee: ESTree.Expression): boolean {
  if (callee.type === "Identifier") return WRAPPERS.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    WRAPPERS.has(callee.property.name)
  );
}

/**
 * A component as the rule sees it: what to call it in the report, where to
 * report it, its binding if it has one, and whether `tracked()` wraps it.
 */
interface Component {
  name: string;
  node: ESTree.Node;
  binding: ESTree.BindingIdentifier | null;
  tracked: boolean;
}

/**
 * The name this function is bound to and whether a `tracked()` call wraps it.
 *
 * Both answers come from the same walk outwards through wrapper calls, because
 * they are two readings of one chain: `memo(tracked(Row))` has to yield the
 * name `Row` and "tracked" together. That is what makes `memo(tracked(fn))`
 * and `tracked(memo(fn))` both read as tracked without either order being
 * special-cased.
 *
 * Only known wrappers are walked through — `tracked`, `memo`, `forwardRef` —
 * and only as their first argument. Any other call means the function is an
 * argument, not the component: `const Content = useMemo(() => <div />, [])`
 * binds a rendered element, not a component.
 *
 * Undefined means there is no binding to name — a `<For>` child callback, an
 * argument, a destructured target — which is exactly the set of functions that
 * are not components. The one unnamed exception is a default export, which is
 * a component however it is written.
 */
function resolveComponent(
  fn: FunctionNode,
  isTrackedCallee: (name: string) => boolean,
): Component | undefined {
  if (fn.type === "FunctionDeclaration") return resolveDeclaration(fn);

  const { at, tracked } = walkWrappers(fn, isTrackedCallee);
  if (at?.type === "VariableDeclarator" && at.id.type === "Identifier") {
    return { name: at.id.name, node: at.id, binding: at.id, tracked };
  }
  if (at?.type === "ExportDefaultDeclaration") {
    return { name: "", node: fn, binding: null, tracked };
  }
  return undefined;
}

/**
 * A function declaration carries its own name and cannot be wrapped in a call.
 * It can still be wrapped afterwards — `tracked(RowImpl)` — which the rule
 * handles separately, by binding.
 */
function resolveDeclaration(fn: ESTree.Function): Component | undefined {
  if (fn.id) return { name: fn.id.name, node: fn.id, binding: fn.id, tracked: false };
  return fn.parent.type === "ExportDefaultDeclaration"
    ? { name: "", node: fn, binding: null, tracked: false }
    : undefined;
}

/**
 * Climbs from `fn` through the wrapper calls it is the first argument of, to
 * the first non-call ancestor. A call on the way that is not a wrapper yields
 * a null ancestor: the function is an argument, not a component.
 */
function walkWrappers(
  fn: FunctionNode,
  isTrackedCallee: (name: string) => boolean,
): { at: ESTree.Node | null; tracked: boolean } {
  let at: ESTree.Node | null = fn.parent,
    child: ESTree.Node = fn,
    tracked = false;
  for (; at?.type === "CallExpression"; child = at, at = at.parent) {
    const { callee } = at;
    if (at.arguments[0] !== child) return { at: null, tracked };
    if (callee.type === "Identifier" && isTrackedCallee(callee.name)) tracked = true;
    else if (!isWrapper(callee)) return { at: null, tracked };
  }
  return { at, tracked };
}

/** Locals destructured from a supergrain hook factory: `const { useStore } = createStoreContext()`. */
function factoryHookNames(
  node: ESTree.VariableDeclarator,
  exportedNameOf: (name: string) => string | undefined,
): Array<string> {
  const { id, init } = node,
    callee = init?.type === "CallExpression" ? calleeName(init) : undefined,
    exported = callee === undefined ? undefined : exportedNameOf(callee);
  if (id.type !== "ObjectPattern" || exported === undefined || !FACTORIES.has(exported)) return [];
  return id.properties.flatMap((property) =>
    property.type === "Property" && property.value.type === "Identifier"
      ? [property.value.name]
      : [],
  );
}

/** The declaration identifiers of the variable `name` resolves to at `node`. */
function bindingIdentifiers(context: Context, node: ESTree.Node, name: string): Array<ESTree.Node> {
  for (let scope: Scope | null = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable.identifiers;
  }
  return [];
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require React components to be wrapped in `tracked()`",
    },
    messages: {
      untracked:
        "`{{name}}` is not wrapped in `tracked()`, so its own reads subscribe to nothing — it re-renders only when a parent happens to. Wrap it: `const {{name}} = tracked(…)`.",
      untrackedDefault:
        "This default-exported component is not wrapped in `tracked()`, so its own reads subscribe to nothing — it re-renders only when a parent happens to. Wrap it: `export default tracked(…)`.",
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
              "Extra hook names that read reactive state, matched by name wherever they are imported from, e.g. the `useStore` returned by `createStoreContext()` in your own module.",
          },
          importSources: IMPORT_SOURCES_SCHEMA,
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const { onlyReactive, storeHooks, importSources } = readOptions(context.options),
      /** Locals destructured from a supergrain hook factory in this file. */
      factoryHooks = new Set<string>(),
      /** Hook-shaped calls, judged at the end once every import has been seen. */
      hookCalls: Array<{ fn: FunctionNode; name: string }> = [],
      imports = createImportTracker(importSources),
      isTrackedCallee = (name: string) => imports.isImported(name, "tracked"),
      /** Functions that rendered JSX. */
      renders = new Set<FunctionNode>(),
      /** Declarations passed by name to `tracked()`: `export const Row = tracked(RowImpl)`. */
      trackedBindings = new Set<ESTree.Node>(),
      userHooks = new Set(storeHooks);

    function isReactiveHook(name: string): boolean {
      if (userHooks.has(name) || factoryHooks.has(name)) return true;
      const exported = imports.exportedNameOf(name);
      return exported !== undefined && REACTIVE_HOOKS.has(exported);
    }

    function recordJsx(node: ESTree.JSXElement | ESTree.JSXFragment): void {
      const fn = enclosingFunction(node);
      if (fn) renders.add(fn);
    }

    function report(fn: FunctionNode, readsReactiveState: Set<FunctionNode>): void {
      if (onlyReactive && !readsReactiveState.has(fn)) return;

      const component = resolveComponent(fn, isTrackedCallee);
      if (!component || component.tracked) return;
      if (component.binding) {
        // A hook name cannot get past this: `useFoo` fails the component test.
        if (!COMPONENT_NAME.test(component.name) || trackedBindings.has(component.binding)) return;
        context.report({
          node: component.node,
          messageId: "untracked",
          data: { name: component.name },
        });
        return;
      }
      context.report({ node: component.node, messageId: "untrackedDefault" });
    }

    return {
      ImportDeclaration(node) {
        imports.visitImport(node);
      },

      JSXElement: recordJsx,
      JSXFragment: recordJsx,

      VariableDeclarator(node) {
        for (const name of factoryHookNames(node, imports.exportedNameOf)) factoryHooks.add(name);
      },

      CallExpression(node) {
        const name = calleeName(node),
          owner = enclosingFunction(node);
        if (!name) return;

        if (isTrackedCallee(name)) {
          for (const argument of node.arguments) {
            if (argument.type === "Identifier") {
              for (const binding of bindingIdentifiers(context, node, argument.name)) {
                trackedBindings.add(binding);
              }
            }
          }
        }

        if (owner) hookCalls.push({ fn: owner, name });
      },

      /**
       * Reported at the end: a component's hooks and its JSX can appear in
       * either order, and both feed the decision — as can a `tracked(RowImpl)`
       * that comes after `RowImpl`, or a factory destructured below its use.
       */
      "Program:exit"() {
        const readsReactiveState = new Set<FunctionNode>();
        for (const { fn, name } of hookCalls) if (isReactiveHook(name)) readsReactiveState.add(fn);
        for (const fn of renders) report(fn, readsReactiveState);
      },
    };
  },
} satisfies Rule;
