import type { Route } from "./+types/home";

import { useState } from "react";
import { Link } from "react-router";

import { GrainField } from "@/components/grain-field";
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
const baseline = 1.52;
const axisMin = 1.4;
const axisMax = 2.0;
const pct = (score: number) => ((score - axisMin) / (axisMax - axisMin)) * 100;

const line = [
  {
    name: "kernel",
    href: "/docs/kernel",
    does: "The store. Plain objects, direct writes, React bindings, and computedList for live, sorted, filtered lists.",
  },
  {
    name: "husk",
    href: "/docs/husk",
    does: "Side effects with cleanup: fetches, subscriptions, timers and DOM behaviors that rerun when what they read changes.",
  },
  {
    name: "silo",
    href: "/docs/silo",
    does: "A document cache for your API. Requests are batched, reads suspend, and fetched documents are state you can change.",
  },
  {
    name: "mill",
    href: "/docs/mill",
    does: "MongoDB-style updates ($set, $push, $pull) applied to the store, with undo.",
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
      <header className="sg-header">
        <Link to="/" className="sg-wordmark" aria-label="Supergrain home">
          SUPERGRAIN
        </Link>
        <nav className="sg-nav">
          <Link to="/docs">Docs</Link>
          <Link to="/docs/comparison">Comparison</Link>
          <a href={github}>GitHub</a>
        </nav>
      </header>

      <section className="sg-hero">
        <div className="sg-hero-text">
          <h1>
            <span className="sg-h1-line">Change one value.</span>{" "}
            <span className="sg-h1-line">
              <span className="sg-nowrap">Re-render</span> one component.
            </span>
          </h1>
          <p>
            Supergrain is reactive state for React. You write plain objects and change them
            directly. Only the components that read the value you changed render again. Not the
            parent, not the siblings.
          </p>
          <div className="sg-actions">
            <Link to="/docs" className="sg-button">
              Read the docs
            </Link>
            <InstallCommand />
          </div>
        </div>
        <GrainField />
      </section>

      <section className="sg-section sg-code">
        <div className="sg-section-text">
          <h2>No reducers. No selectors. Just assignment.</h2>
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
        <div className="sg-chart" role="table" aria-label="js-framework-benchmark weighted scores">
          <div
            className="sg-chart-baseline"
            style={{ "--p": pct(baseline) / 100 } as React.CSSProperties}
          >
            <span>React with no library, 1.52</span>
          </div>
          {results.map((r) => (
            <div key={r.name} className={r.us ? "sg-bar sg-bar-us" : "sg-bar"} role="row">
              <span className="sg-bar-name" role="cell">
                {r.name}
              </span>
              <span className="sg-bar-track" role="cell">
                <span className="sg-bar-fill" style={{ width: `${pct(r.score)}%` }} />
              </span>
              <span className="sg-bar-score" role="cell">
                {r.score.toFixed(2)}
              </span>
            </div>
          ))}
          <p className="sg-chart-source">
            Weighted geometric mean across create, update, replace, swap, select, remove and clear.
            The axis starts at 1.40. Source:{" "}
            <a href="https://krausest.github.io/js-framework-benchmark/current.html">
              js-framework-benchmark
            </a>
            .
          </p>
        </div>
      </section>

      <section className="sg-section sg-line">
        <div className="sg-section-text">
          <h2>The rest of the grain line</h2>
          <p>
            Start with the kernel. Add the other packages when your app needs them. They share one
            reactive graph, so data from your API and your own state update the same way.
          </p>
        </div>
        <ul className="sg-line-list">
          {line.map((pkg) => (
            <li key={pkg.name}>
              <Link to={pkg.href}>
                <span className="sg-line-name">{pkg.name}</span>
                <span className="sg-line-does">{pkg.does}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="sg-footer">
        <span className="sg-wordmark">SUPERGRAIN</span>
        <span>MIT licensed.</span>
        <a href={github}>GitHub</a>
      </footer>
    </div>
  );
}
