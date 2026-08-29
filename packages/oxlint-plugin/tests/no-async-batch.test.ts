import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "../src/rules/no-async-batch.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-async-batch", rule, {
  valid: [
    // The correct shape: await first, then batch the synchronous writes.
    `import { batch } from "@supergrain/kernel";
     async function save(store) {
       const data = await load();
       batch(() => { store.a = data.a; store.b = data.b; });
     }`,

    // A sync callback is the whole point of batch.
    `import { batch } from "@supergrain/kernel";
     batch(() => { store.a = 1; });`,

    // Someone else's `batch` is not ours to police.
    `import { batch } from "some-other-lib";
     batch(async () => {});`,

    // Not imported at all.
    `batch(async () => {});`,

    // No callback to inspect.
    `import { batch } from "@supergrain/kernel";
     batch();`,

    // A default import doesn't name an export, so it binds nothing.
    `import batch from "@supergrain/kernel";
     batch(async () => {});`,

    // Namespace imports are not resolved either — documented limitation.
    `import * as sg from "@supergrain/kernel";
     sg.batch(async () => {});`,

    // A string-named import still resolves to its export name.
    `import { "batch" as b } from "@supergrain/kernel";
     b(() => { store.a = 1; });`,

    // A non-function first argument.
    `import { batch } from "@supergrain/kernel";
     batch(someCallback);`,
  ],

  invalid: [
    {
      code: `import { batch } from "@supergrain/kernel";
             batch(async () => { store.a = await load(); });`,
      errors: [{ messageId: "asyncBatch" }],
    },
    {
      // Aliased import still resolves to the same export.
      code: `import { batch as b } from "@supergrain/kernel";
             b(async () => {});`,
      errors: [{ messageId: "asyncBatch" }],
    },
    {
      // Async function expression, not just arrows.
      code: `import { batch } from "@supergrain/kernel";
             batch(async function () { await x(); });`,
      errors: [{ messageId: "asyncBatch" }],
    },
  ],
});
