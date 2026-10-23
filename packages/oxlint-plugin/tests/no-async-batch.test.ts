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

    // A named callback that resolves to a sync function.
    `import { batch } from "@supergrain/kernel";
     function apply() { store.a = 1; }
     batch(apply);`,

    // A parameter could be anything — not resolved.
    `import { batch } from "@supergrain/kernel";
     function run(cb) { batch(cb); }`,

    // A `let` may be reassigned before the call — not resolved. Documented.
    `import { batch } from "@supergrain/kernel";
     let save = async () => {};
     batch(save);`,

    // A local shadowing the async function is what the call sees.
    `import { batch } from "@supergrain/kernel";
     const save = async () => {};
     function run() { const save = () => {}; batch(save); }`,

    // A barrel is not recognised until it is listed in importSources.
    `import { batch } from "@/lib/state";
     batch(async () => {});`,
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
    {
      // A locally declared async function, passed by name.
      code: `import { batch } from "@supergrain/kernel";
             async function save() { store.a = await load(); }
             batch(save);`,
      errors: [{ messageId: "asyncBatch" }],
    },
    {
      // A const bound to an async arrow, passed by name from a nested scope.
      code: `import { batch } from "@supergrain/kernel";
             const save = async () => { store.a = await load(); };
             function run() { batch(save); }`,
      errors: [{ messageId: "asyncBatch" }],
    },
    {
      // importSources: a project barrel that re-exports batch.
      code: `import { batch } from "@/lib/state";
             batch(async () => {});`,
      options: [{ importSources: ["@supergrain/", "@/lib/state"] }],
      errors: [{ messageId: "asyncBatch" }],
    },
  ],
});
