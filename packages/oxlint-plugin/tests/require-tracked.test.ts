import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "../src/rules/require-tracked.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

const TRACKED = `import { tracked } from "@supergrain/kernel/react";\n`;

tester.run("require-tracked", rule, {
  valid: [
    `${TRACKED}const Row = tracked(() => <tr />);`,
    `${TRACKED}const Row = tracked(function Row() { return <tr />; });`,

    // tracked inside another wrapper, and outside one — both are tracked.
    `${TRACKED}import { memo } from "react";
     const Row = memo(tracked(() => <tr />));`,
    `${TRACKED}import { memo } from "react";
     const Row = tracked(memo(() => <tr />));`,

    // Not components: no JSX at all.
    `${TRACKED}function helper() { return 1; }`,
    `${TRACKED}const compute = () => 2;`,

    // Hooks are not components, even when they hand back JSX.
    `${TRACKED}function useBadge() { return <span />; }`,

    // Lowercase: a helper, not a component.
    `${TRACKED}function renderCell() { return <td />; }`,

    // The child callback of <For> returns JSX but is not a component
    // declaration — flagging it would be wrong.
    `${TRACKED}const List = tracked(() => (
       <For each={rows}>{(r) => <Row row={r} />}</For>
     ));`,

    // onlyReactive: a presentational component is allowed to go unwrapped.
    {
      code: `${TRACKED}function Row() { return <tr />; }`,
      options: [{ onlyReactive: true }],
    },

    // JSX produced only inside a nested helper belongs to the helper, which
    // has no component name — so the outer function is not treated as one.
    `${TRACKED}function Row() {
       const render = () => <tr />;
       return render();
     }`,

    // A reactive hook called at module scope has no component to attribute to.
    `${TRACKED}import { useReactive } from "@supergrain/kernel/react";
     const s = useReactive({ n: 0 });`,

    // JSX at module scope has no enclosing function to attribute it to.
    `${TRACKED}const el = <tr />;`,

    // Destructured declarator: not a component binding.
    `${TRACKED}const { Row } = components;`,

    // A call that wraps no function at all.
    `${TRACKED}const Row = makeRow();`,

    // Anonymous arrow: no capitalised name to judge by.
    `${TRACKED}const x = () => <tr />;`,
  ],

  invalid: [
    {
      code: `${TRACKED}function Row() { return <tr />; }`,
      errors: [{ messageId: "untracked" }],
    },
    {
      code: `${TRACKED}const Row = () => <tr />;`,
      errors: [{ messageId: "untracked" }],
    },
    {
      code: `${TRACKED}const Row = function () { return <tr />; };`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // JSX behind a conditional still renders.
      code: `${TRACKED}function Row({ show }) { if (!show) return null; return <tr />; }`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // Wrapped in something that isn't supergrain's tracked.
      code: `${TRACKED}import { memo } from "react";
             const Row = memo(() => <tr />);`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // One report per component, not one per JSX element in it. The rule
      // collects rendering functions in a Set, so this is worth pinning.
      code: `${TRACKED}function Row() { return <tr><td /><td /></tr>; }`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // A component nested inside a tracked one is still its own component.
      code: `${TRACKED}const Outer = tracked(() => {
               const Inner = () => <span />;
               return <Inner />;
             });`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // onlyReactive with the hook call AFTER the JSX: the decision is made at
      // Program:exit, so source order must not matter.
      code: `${TRACKED}import { useReactive } from "@supergrain/kernel/react";
             function Row() {
               const el = <tr />;
               const s = useReactive({ n: 0 });
               return el;
             }`,
      options: [{ onlyReactive: true }],
      errors: [{ messageId: "untracked" }],
    },
    {
      // onlyReactive: this one does read reactive state, so it's still flagged.
      code: `${TRACKED}import { useReactive } from "@supergrain/kernel/react";
             function Row() { const s = useReactive({ n: 0 }); return <tr>{s.n}</tr>; }`,
      options: [{ onlyReactive: true }],
      errors: [{ messageId: "untracked" }],
    },
    {
      // onlyReactive + a project's own store hook, declared via storeHooks.
      code: `${TRACKED}function Row() { const s = useStore(); return <tr>{s.n}</tr>; }`,
      options: [{ onlyReactive: true, storeHooks: ["useStore"] }],
      errors: [{ messageId: "untracked" }],
    },
  ],
});
