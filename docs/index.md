---
layout: page
---

<div class="hero-banner">
  <p class="hero-eyebrow">Reactive state for React</p>
  <h1 class="hero-title">What if the fastest state library was also the most ergonomic?</h1>
  <p class="hero-tagline">Mutate state directly. Re-render only the leaf that changed. No reducers, no selectors, no ceremony.</p>
  <div class="hero-actions">
    <a href="#quick-start" class="btn-primary">Get Started</a>
    <a href="https://github.com/commoncurriculum/supergrain" class="btn-secondary">GitHub</a>
  </div>
</div>

<div class="hero-section">
  <div class="hero-values">
    <div class="hero-values-group hero-values-group--yep">
      <p class="hero-values-label">What you get</p>
      <ul class="hero-yep">
        <li><span class="yep-check">✓</span><span class="yep-body"><span class="yep-label">Plain JS&nbsp;—</span> <code>{ user: { name } }</code></span></li>
        <li><span class="yep-check">✓</span><span class="yep-body"><span class="yep-label">Direct mutation&nbsp;—</span> <code>store.x = 1</code></span></li>
        <li><span class="yep-check">✓</span><span class="yep-body"><span class="yep-label">Deep reactivity&nbsp;—</span> <code>store.a.b[0].c</code>, or whatever nested shape you want</span></li>
        <li><span class="yep-check">✓</span><span class="yep-body"><span class="yep-label">TypeScript inference&nbsp;—</span> no generics, no casts</span></li>
        <li><span class="yep-check">✓</span><span class="yep-body"><span class="yep-label">Works with SSR&nbsp;—</span> Next.js, RSC, React 19</span></li>
        <li><span class="yep-check">✓</span><span class="yep-body">~5kb gzipped</span></li>
      </ul>
    </div>
    <div class="hero-values-group hero-values-group--nope">
      <p class="hero-values-label">What you don't have to use</p>
      <ul class="hero-nope">
        <li><span class="nope-x">×</span><span class="yep-body">No selectors</span></li>
        <li><span class="nope-x">×</span><span class="yep-body">No actions</span></li>
        <li><span class="nope-x">×</span><span class="yep-body">No reducers</span></li>
        <li><span class="nope-x">×</span><span class="yep-body">No dispatch</span></li>
        <li><span class="nope-x">×</span><span class="yep-body">No <code>useMemo</code> / <code>useCallback</code> dance</span></li>
        <li><span class="nope-x">×</span><span class="yep-body">No immutability rules</span></li>
      </ul>
    </div>
  </div>
  <div class="hero-code">

```tsx
import { createStore } from "@supergrain/core";
import { tracked, provideStore, For } from "@supergrain/react";

const Store = provideStore(
  createStore({
    todos: [
      { id: 1, text: "Ship it", done: false },
      { id: 2, text: "Sleep", done: true },
    ],
  }),
);

const TodoList = tracked(() => {
  const { todos } = Store.useStore();
  return (
    <For each={todos}>
      {(todo) => (
        <li onClick={() => (todo.done = !todo.done)}>
          {todo.done ? "✓" : "○"} {todo.text}
        </li>
      )}
    </For>
  );
});
```

  </div>
</div>

<section class="benchmark-section">
  <div class="benchmark-header">
    <p class="benchmark-eyebrow">js-framework-benchmark · weighted geometric mean</p>
    <h2 class="benchmark-title">The fastest state library for React.</h2>
    <p class="benchmark-sub">Lower is better. Supergrain matches raw <code>useState</code> — and beats every other state management library on the chart.</p>
  </div>
  <div class="benchmark-chart">
    <div class="bench-row bench-row--baseline">
      <div class="bench-name">react-hooks <span class="bench-tag">baseline · no library</span></div>
      <div class="bench-bar"><div class="bench-fill" style="width: 76.7%"></div></div>
      <div class="bench-score">1.52</div>
    </div>
    <div class="bench-divider">
      <span class="bench-divider-label">State management libraries</span>
    </div>
    <div class="bench-row bench-row--us">
      <div class="bench-name">supergrain</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 76.7%"></div></div>
      <div class="bench-score">1.52</div>
    </div>
    <div class="bench-row">
      <div class="bench-name">rxjs</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 77.2%"></div></div>
      <div class="bench-score">1.53</div>
    </div>
    <div class="bench-row">
      <div class="bench-name">tagged-state</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 78.7%"></div></div>
      <div class="bench-score">1.56</div>
    </div>
    <div class="bench-row">
      <div class="bench-name">zustand</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 82.3%"></div></div>
      <div class="bench-score">1.63</div>
    </div>
    <div class="bench-row">
      <div class="bench-name">mobX</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 83.8%"></div></div>
      <div class="bench-score">1.66</div>
    </div>
    <div class="bench-row">
      <div class="bench-name">redux-hooks</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 84.3%"></div></div>
      <div class="bench-score">1.67</div>
    </div>
    <div class="bench-row">
      <div class="bench-name">react-tracked</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 88.9%"></div></div>
      <div class="bench-score">1.76</div>
    </div>
    <div class="bench-row">
      <div class="bench-name">redux</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 100%"></div></div>
      <div class="bench-score">1.98</div>
    </div>
  </div>
  <p class="benchmark-footnote">
    Source: <a href="https://krausest.github.io/js-framework-benchmark/current.html" target="_blank" rel="noopener">js-framework-benchmark by Stefan Krause</a>. Weighted geometric mean across create, update, replace, swap, select, remove, and clear scenarios.
  </p>
</section>

<div class="features-strip">
  <div class="feature">
    <div class="feature-number">01</div>
    <div class="feature-text">
      <strong>Fine-grained</strong>
      <span>Only re-renders what actually changed. Not the parent. Not siblings. Just that one component.</span>
    </div>
  </div>
  <div class="feature">
    <div class="feature-number">02</div>
    <div class="feature-text">
      <strong>Ergonomic</strong>
      <span>Read properties. Assign values. Push to arrays. No actions, reducers, selectors, or dispatch.</span>
    </div>
  </div>
  <div class="feature">
    <div class="feature-number">03</div>
    <div class="feature-text">
      <strong>Performant</strong>
      <span>Solid.js-level signal speed with per-component scoping. Benchmarks on par with plain React hooks.</span>
    </div>
  </div>
</div>

<div class="readme-content">

<!--@include: ../README.md-->

</div>
