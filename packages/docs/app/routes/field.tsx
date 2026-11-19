import { Link } from "react-router";

import { GrainEditor, GrainField } from "@/components/grain-field";
import { gitConfig } from "@/lib/shared";

// A second homepage direction, kept beside the cereal box until one is chosen.

export function meta() {
  return [{ title: "Supergrain: change one value, re-render one component" }];
}

const github = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export default function Field() {
  return (
    <div className="sg-home sg-field-page">
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
      <GrainField />
      <section className="sg-field-row">
        <div>
          <h1>Change one value. One component re-renders.</h1>
          <p className="sg-sub">
            Supergrain is reactive state for React. Every grain above is its own component, and the
            examples in the box change them. Try one and watch the count.
          </p>
          <div className="sg-actions">
            <Link to="/docs" className="sg-button">
              Read the docs
            </Link>
            <code className="sg-field-install">pnpm add @supergrain/kernel</code>
          </div>
        </div>
        <GrainEditor />
      </section>
    </div>
  );
}
