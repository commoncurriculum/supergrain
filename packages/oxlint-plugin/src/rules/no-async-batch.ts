import type { Context, ESTree, Rule, Scope, Variable } from "@oxlint/plugins";

import { calleeName, createImportTracker, readImportSources } from "../imports.js";
import { IMPORT_SOURCES_SCHEMA } from "../options.js";

/**
 * `batch(fn)` is synchronous and throws when `fn` returns a Promise.
 *
 * TypeScript does not catch this. `batch` takes a `() => void` callback, and TS
 * deliberately allows a Promise-returning function wherever a void-returning one
 * is expected, so `batch(async () => …)` type-checks and then throws at runtime.
 *
 * Skill: "Wrap _multiple_ related writes in `batch(fn)`; sync only, throws on a
 * returned Promise."
 *
 * The callback is judged where it is written, or — for `batch(save)` — where
 * `save` is declared, as long as that is a function declaration or a `const`
 * bound to a function in this file. Anything else (a parameter, an import, a
 * `let` that may be reassigned) could be either, so it is left alone.
 */

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

function isFunction(node: ESTree.Node | null | undefined): node is FunctionNode {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

/**
 * The function a variable is declared as, if its declaration pins one down: a
 * function declaration, or a `const` initialised with a function.
 */
function declaredFunction(variable: Variable): FunctionNode | undefined {
  // A redeclared name could be either declaration at the call; don't guess.
  if (variable.defs.length !== 1) return undefined;
  const [def] = variable.defs;
  if (def?.type === "FunctionName" && isFunction(def.node)) return def.node;
  if (
    def?.type === "Variable" &&
    def.node.type === "VariableDeclarator" &&
    def.parent?.type === "VariableDeclaration" &&
    def.parent.kind === "const" &&
    isFunction(def.node.init)
  ) {
    return def.node.init;
  }
  return undefined;
}

/** The function an identifier argument names, resolved from the call's scope. */
function resolveLocalFunction(
  context: Context,
  call: ESTree.CallExpression,
  name: string,
): FunctionNode | undefined {
  for (let scope: Scope | null = context.sourceCode.getScope(call); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return declaredFunction(variable);
  }
  return undefined;
}

/** The function `batch` was handed: written inline, or named and declared in this file. */
function callbackFunction(
  context: Context,
  call: ESTree.CallExpression,
  callback: ESTree.Argument,
): FunctionNode | undefined {
  if (callback.type === "Identifier") return resolveLocalFunction(context, call, callback.name);
  return isFunction(callback) ? callback : undefined;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow passing an async callback to `batch()`",
    },
    messages: {
      asyncBatch:
        "`batch()` is synchronous and throws on a returned Promise. Await first, then batch the writes: `const data = await load(); batch(() => { … })`.",
    },
    schema: [
      {
        type: "object",
        properties: { importSources: IMPORT_SOURCES_SCHEMA },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const imports = createImportTracker(readImportSources(context.options));

    return {
      ImportDeclaration(node) {
        imports.visitImport(node);
      },

      CallExpression(node) {
        const name = calleeName(node),
          [callback] = node.arguments;
        if (!name || !imports.isImported(name, "batch")) return;
        if (!callback || !callbackFunction(context, node, callback)?.async) return;

        context.report({ node: callback, messageId: "asyncBatch" });
      },
    };
  },
} satisfies Rule;
