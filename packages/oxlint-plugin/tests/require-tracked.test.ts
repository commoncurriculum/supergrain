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

    // Wrapped after declaration: the declaration is the implementation of a
    // tracked component, not a component of its own.
    `${TRACKED}function RowImpl() { return <tr />; }
     export const Row = tracked(RowImpl);`,
    `${TRACKED}const RowImpl = () => <tr />;
     export const Row = tracked(RowImpl);`,
    // Order doesn't matter: function declarations hoist.
    `${TRACKED}export const Row = tracked(RowImpl);
     function RowImpl() { return <tr />; }`,

    // A call that isn't a component wrapper takes the function as an argument;
    // what it binds is a rendered element, not a component.
    `${TRACKED}import { useMemo } from "react";
     const List = tracked(() => {
       const Content = useMemo(() => <div />, []);
       return Content;
     });`,

    // Default exports are components too, and this one is tracked.
    `${TRACKED}export default tracked(() => <div />);`,
    `${TRACKED}const Row = tracked(() => <tr />);
     export default Row;`,

    // onlyReactive: a hook that merely shares a supergrain hook's name is not
    // supergrain's, so it doesn't make the component reactive.
    {
      code: `${TRACKED}import { useQuery } from "@tanstack/react-query";
             function Row() { const q = useQuery({}); return <tr>{q.data}</tr>; }`,
      options: [{ onlyReactive: true }],
    },
    // ... nor does one that isn't imported at all.
    {
      code: `${TRACKED}function Row() { const s = useReactive({ n: 0 }); return <tr>{s.n}</tr>; }`,
      options: [{ onlyReactive: true }],
    },

    // importSources: a barrel that re-exports supergrain's tracked.
    {
      code: `import { tracked } from "@/lib/state";
             const Row = tracked(() => <tr />);`,
      options: [{ importSources: ["@supergrain/", "@/lib/state"] }],
    },
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
      // Passing a declaration to a `tracked` that isn't supergrain's proves nothing.
      code: `import { tracked } from "./my-hoc";
             function RowImpl() { return <tr />; }
             export const Row = tracked(RowImpl);`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // Without importSources, a barrel's tracked is not recognised — reported,
      // so the misconfiguration surfaces instead of hiding every component.
      code: `import { tracked } from "@/lib/state";
             const Row = tracked(() => <tr />);`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // A module entry matches its subpaths but not a longer name.
      code: `import { tracked } from "@/lib/statement";
             const Row = tracked(() => <tr />);`,
      options: [{ importSources: ["@/lib/state"] }],
      errors: [{ messageId: "untracked" }],
    },
    {
      code: `${TRACKED}export default () => <div />;`,
      errors: [{ messageId: "untrackedDefault" }],
    },
    {
      code: `${TRACKED}export default function () { return <div />; }`,
      errors: [{ messageId: "untrackedDefault" }],
    },
    {
      code: `${TRACKED}export default (function () { return <div />; });`,
      errors: [{ messageId: "untrackedDefault" }],
    },
    {
      code: `${TRACKED}import { memo } from "react";
             export default memo(() => <div />);`,
      errors: [{ messageId: "untrackedDefault" }],
    },
    {
      // React.forwardRef is walked through like memo.
      code: `${TRACKED}import React from "react";
             const Input = React.forwardRef((props, ref) => <input ref={ref} />);`,
      errors: [{ messageId: "untracked" }],
    },
    {
      // onlyReactive: a hook destructured from a supergrain factory in this file.
      code: `import { createStoreContext } from "@supergrain/kernel/react";
             const { Provider, useStore } = createStoreContext();
             function Row() { const s = useStore(); return <tr>{s.n}</tr>; }`,
      options: [{ onlyReactive: true }],
      errors: [{ messageId: "untracked" }],
    },
    {
      // onlyReactive: a silo hook re-exported by a configured barrel.
      code: `import { useDocument } from "@/store";
             function Row() { const d = useDocument("todo", "1"); return <tr>{d.data}</tr>; }`,
      options: [{ onlyReactive: true, importSources: ["@supergrain/", "@/store"] }],
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
