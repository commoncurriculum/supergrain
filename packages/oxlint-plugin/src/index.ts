import type { Plugin } from "@oxlint/plugins";

import noAsyncBatch from "./rules/no-async-batch.js";
import requireTracked from "./rules/require-tracked.js";

/**
 * Oxlint rules for supergrain.
 *
 * These rules cover one specific gap. TypeScript already catches the mistakes
 * that are visible in types — `update()` arity, calling `undo` as a function,
 * importing `useDocument` from `@supergrain/silo/react` — and it reports them
 * better than a linter would. What it cannot see is code that type-checks,
 * renders, and is silently non-reactive. That is what these rules are for.
 *
 * `@oxlint/plugins` is imported for types only. Its `definePlugin` and
 * `defineRule` are identity functions, and importing them at runtime would make
 * the built plugin need a package that consumers don't install — oxlint loads
 * this file from the consumer's tree. `tests/dist.test.ts` guards that.
 */
const plugin: Plugin = {
  meta: { name: "supergrain" },
  rules: {
    "require-tracked": requireTracked,
    "no-async-batch": noAsyncBatch,
  },
};

export default plugin;
