import { Link } from "react-router";

import { GrainField, GrainInspector, GrainStats, SpeedControl } from "@/components/grain-field";
import { gitConfig } from "@/lib/shared";
import { ingredients, results } from "@/lib/site-data";

// A second homepage direction, kept beside the cereal box until one is chosen.

export function meta() {
  return [{ title: "Supergrain: change one value, re-render one component" }];
}

const github = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
const slowest = Math.max(...results.map((r) => r.score));

export default function Field() {
  return (
    <div className="sg-home sg-field-page">
      <GrainField />
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

      <main className="sg-field-main">
        <section className="sg-slab sg-slab-hero">
          <div>
            <h1>Change one value. One component re-renders.</h1>
            <p className="sg-sub">
              Supergrain is reactive state for React. Every grain on this page is a plain object,
              and a loop moves them by assigning to those objects. Click one to open it.
            </p>
            <div className="sg-actions">
              <Link to="/docs" className="sg-button">
                Read the docs
              </Link>
              <code className="sg-field-install">pnpm add @supergrain/kernel</code>
            </div>
          </div>
          <GrainInspector />
          <GrainStats />
        </section>

        <section className="sg-slab sg-slab-code">
          <div>
            <h2>This is all of the code.</h2>
            <p>
              Make an object. Read it in a component. Assign to it from anywhere. There are no
              reducers, no selectors and no setState, and nested objects and arrays work the same
              way.
            </p>
            <SpeedControl />
          </div>
          <pre tabIndex={0}>
            <code>
              {`const store = createReactive({ speed: 1, grains });

const Grain = tracked(({ grain }) => (
  <path fill={grain.color} style={place(grain)} />
));

// Every frame, a few grains drift.
grain.dx = wander();
grain.turn += 4;

// You click one and change it.
grain.color = "#ff5a36";`}
            </code>
          </pre>
        </section>

        <section className="sg-slab sg-slab-bench">
          <div>
            <h2>As fast as plain useState.</h2>
            <p>
              On js-framework-benchmark Supergrain scores 1.52, the same as React with no state
              library. Lower is better.{" "}
              <a href="https://krausest.github.io/js-framework-benchmark/current.html">Source</a>
            </p>
          </div>
          <ol>
            {results.map((r) => (
              <li key={r.name} className={r.us ? "sg-bench-us" : undefined}>
                <span>{r.us ? "Supergrain" : r.name}</span>
                <i style={{ width: `${(r.score / slowest) * 100}%` }} />
                <b>{r.score.toFixed(2)}</b>
              </li>
            ))}
          </ol>
        </section>

        <section className="sg-slab sg-slab-packages">
          <h2>Start with the kernel. Add the rest when you need it.</h2>
          <ul>
            {ingredients.map((pkg) => (
              <li key={pkg.name}>
                <Link to={pkg.href}>{pkg.name}</Link>
                <span>{pkg.does}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
