import { definePlugin } from "@oxlint/plugins";

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
 */
export default definePlugin({
  meta: { name: "supergrain" },
  rules: {
    "require-tracked": requireTracked,
    "no-async-batch": noAsyncBatch,
  },
});
