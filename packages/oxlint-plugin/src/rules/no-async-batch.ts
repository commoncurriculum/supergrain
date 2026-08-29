import { defineRule } from "@oxlint/plugins";

import { calleeName, createImportTracker } from "../imports.js";

/**
 * `batch(fn)` is synchronous and throws when `fn` returns a Promise.
 *
 * TypeScript does not catch this. `batch` takes a `() => void` callback, and TS
 * deliberately allows a Promise-returning function wherever a void-returning one
 * is expected, so `batch(async () => …)` type-checks and then throws at runtime.
 *
 * Skill: "Wrap _multiple_ related writes in `batch(fn)`; sync only, throws on a
 * returned Promise."
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow passing an async callback to `batch()`",
    },
    messages: {
      asyncBatch:
        "`batch()` is synchronous and throws on a returned Promise. Await first, then batch the writes: `const data = await load(); batch(() => { … })`.",
    },
  },

  create(context) {
    const imports = createImportTracker();

    return {
      ImportDeclaration(node) {
        imports.visitImport(node);
      },

      CallExpression(node) {
        const name = calleeName(node),
          [callback] = node.arguments;
        if (!name || !imports.isImported(name, "batch")) return;
        if (!callback) return;
        if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") {
          return;
        }
        if (!callback.async) return;

        context.report({ node: callback, messageId: "asyncBatch" });
      },
    };
  },
});
