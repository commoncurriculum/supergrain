import type { Route } from "./+types/home";

import { useState } from "react";
import { Link } from "react-router";

import { DemoControls } from "@/components/cereal-bowl";
import { CerealBox } from "@/components/cereal-box";
import { gitConfig } from "@/lib/shared";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Supergrain: change one value, re-render one component" },
    {
      name: "description",
      content:
        "Reactive state for React. Write plain objects, change them directly, and only the components that read a changed value re-render.",
    },
  ];
}

const github = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

// js-framework-benchmark, weighted geometric mean (lower is better).
const results = [
  { name: "supergrain", score: 1.52, us: true },
  { name: "rxjs", score: 1.53 },
  { name: "tagged-state", score: 1.56 },
  { name: "zustand", score: 1.63 },
  { name: "mobX", score: 1.66 },
  { name: "redux-hooks", score: 1.67 },
  { name: "react-tracked", score: 1.76 },
  { name: "valtio", score: 1.89 },
  { name: "redux", score: 1.98 },
];
const ingredients = [
  {
    name: "kernel",
    href: "/docs/kernel",
    does: "the store: plain objects, direct writes, React bindings, and live sorted and filtered lists",
  },
  {
    name: "husk",
    href: "/docs/husk",
    does: "side effects with cleanup, such as fetches, subscriptions and timers",
  },
  {
    name: "silo",
    href: "/docs/silo",
    does: "a document cache for your API, with batched requests and Suspense",
  },
  {
    name: "queries",
    href: "/docs/queries",
    does: "paginated and live-updating queries for silo",
  },
  {
    name: "mill",
    href: "/docs/mill",
    does: "MongoDB-style updates like $set and $push, with undo",
  },
];

function InstallCommand() {
  const command = "pnpm add @supergrain/kernel";
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="sg-install"
      onClick={() => {
        void navigator.clipboard?.writeText(command).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <code>{command}</code>
      <span className="sg-install-hint">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export default function Home() {
  return (
    <div className="sg-home">
      <div className="sg-front">
        <header className="sg-header">
          <Link to="/" className="sg-wordmark" aria-label="Supergrain home">
            Supergrain
          </Link>
          <nav className="sg-nav">
            <Link to="/docs">Docs</Link>
            <Link to="/docs/comparison">Comparison</Link>
            <a href={github}>GitHub</a>
          </nav>
        </header>

        <section className="sg-hero">
          <div className="sg-hero-text">
            <h1>Change one value. One component re-renders.</h1>
            <p className="sg-sub">
              Supergrain is reactive state for React. Every piece in the bowl is its own component.
              One value changes every second or so. Watch which piece moves, then switch to
              useState.
            </p>
            <div className="sg-actions">
              <Link to="/docs" className="sg-button">
                Read the docs
              </Link>
              <InstallCommand />
            </div>
          </div>

          <CerealBox />

          <div className="sg-table">
            <p>Drag the box to turn it. The numbers are on the side.</p>
            <DemoControls />
          </div>
        </section>
      </div>

      <section className="sg-section sg-code">
        <div className="sg-section-text">
          <h2>
            <span>No reducers.</span> <span>No selectors.</span> <span>Just assignment.</span>
          </h2>
          <p>
            Read a property in a component and Supergrain remembers that this component needs it.
            Assign to it anywhere and that component renders. Nested objects and arrays work the
            same way, at any depth, with full TypeScript inference and no generics.
          </p>
          <p>
            In this todo list, clicking a todo renders only that todo's row. The list doesn't
            render, and neither do the other rows.
          </p>
        </div>
        <pre className="sg-snippet" tabIndex={0}>
          <code>
            {`import { tracked, useReactive, For } from "@supergrain/kernel/react";

const TodoList = tracked(() => {
  const state = useReactive({
    todos: [
      { id: 1, text: "Ship it", done: false },
      { id: 2, text: "Sleep", done: true },
    ],
  });

  return (
    <For each={state.todos}>
      {(todo) => (
        <li onClick={() => (`}
            <mark>todo.done = !todo.done</mark>
            {`)}>
          {todo.done ? "✓" : "○"} {todo.text}
        </li>
      )}
    </For>
  );
});`}
          </code>
        </pre>
      </section>

      <section className="sg-section sg-bench">
        <div className="sg-section-text">
          <h2>As fast as plain useState.</h2>
          <p>
            On Stefan Krause's js-framework-benchmark, Supergrain scores 1.52, the same as React
            with no state library at all. Every other state library on the chart is slower. Lower is
            better.
          </p>
        </div>
        <div className="sg-shelf-wrap">
          <ul className="sg-shelf">
            {results.map((r) => (
              <li key={r.name} className={r.us ? "sg-shelf-us" : undefined}>
                <span className="sg-shelf-box">
                  <span className="sg-shelf-name">{r.us ? "Supergrain" : r.name}</span>
                  <span className="sg-shelf-bowl" />
                </span>
                <span className="sg-shelf-tag">
                  <span>{r.us ? "same as no library" : "score"}</span>
                  <b>{r.score.toFixed(2)}</b>
                </span>
              </li>
            ))}
          </ul>
          <p className="sg-chart-source">
            Weighted geometric mean across create, update, replace, swap, select, remove and clear.
            React with no state library scores 1.52. Source:{" "}
            <a href="https://krausest.github.io/js-framework-benchmark/current.html">
              js-framework-benchmark
            </a>
            .
          </p>
        </div>
      </section>

      <section className="sg-section sg-ingredients">
        <div className="sg-section-text">
          <h2>Ingredients</h2>
          <p>
            Start with the kernel. Add the other packages when your app needs them. They share one
            reactive graph, so data from your API and your own state update the same way. Each name
            links to its docs.
          </p>
        </div>
        <ul className="sg-ingredient-list">
          {ingredients.map((pkg) => (
            <li key={pkg.name}>
              <Link to={pkg.href}>
                <span className="sg-ingredient-name">{pkg.name}</span> ({pkg.does})
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="sg-footer">
        <span className="sg-wordmark">Supergrain</span>
        <span>MIT licensed.</span>
        <a href={github}>GitHub</a>
      </footer>
    </div>
  );
}
