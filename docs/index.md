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
        <li><span class="yep-check">✓</span><span class="yep-body"><span class="yep-label">Live queries&nbsp;—</span> filter, join, sort, update per row</span></li>
        <li><span class="yep-check">✓</span><span class="yep-body"><span class="yep-label">Works with SSR&nbsp;—</span> Next.js, RSC, React 19</span></li>
        <li><span class="yep-check">✓</span><span class="yep-body">3.6 kB min+brotli (including core)</span></li>
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
import { tracked, useReactive, For } from "@supergrain/kernel/react";

const TodoList = tracked(() => {
  const { todos } = useReactive({
    todos: [
      { id: 1, text: "Ship it", done: false },
      { id: 2, text: "Sleep", done: true },
    ],
  });

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
      <div class="bench-name">valtio</div>
      <div class="bench-bar"><div class="bench-fill" style="width: 95.5%"></div></div>
      <div class="bench-score">1.89</div>
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

<section class="lq-section">
  <div class="benchmark-header">
    <p class="benchmark-eyebrow">New in 7.6 · <code>computedList</code></p>
    <h2 class="benchmark-title">Live queries that only redo what changed.</h2>
    <p class="benchmark-sub">Filter, join, group, sort and page a list from your store. When one task changes, <code>computedList</code> checks that one task and moves its row. It does not filter and sort the other 9,999 again.</p>
  </div>

  <div class="lq-compare">
    <div class="lq-panel">
      <p class="lq-panel-label">Before · <code>stableComputed</code></p>
      <div class="hero-code lq-code">

```ts
const openTasks = stableComputed(() =>
  store.tasks
    .filter((task) => !task.done)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 10),
);
```

  </div>
      <p class="lq-panel-note">Any change to any task runs the whole chain: filter 10,000 tasks, sort what's left, take 10.</p>
    </div>
    <div class="lq-panel lq-panel--after">
      <p class="lq-panel-label">After · <code>computedList</code></p>
      <div class="hero-code lq-code">

```ts
const openTasks = computedList(() => store.tasks)
  .filter((task) => !task.done)
  .orderBy((task) => task.priority)
  .limit(10);
```

  </div>
      <p class="lq-panel-note">Same query, same result. A change reruns the steps for the one task it touched, then moves that row with a binary search.</p>
    </div>
  </div>

  <div class="lq-race">
    <p class="lq-race-title">Mark one task done in a list of 10,000, then read the list</p>
    <div class="lq-race-track">
      <div class="lq-race-row">
        <div class="lq-race-name"><code>stableComputed</code></div>
        <div class="lq-race-bar"><div class="lq-race-fill" style="width: 68.6%"></div></div>
        <div class="lq-race-time">11.5 ms</div>
      </div>
      <div class="lq-race-row">
        <div class="lq-race-name">TanStack DB live query</div>
        <div class="lq-race-bar"><div class="lq-race-fill" style="width: 25.6%"></div></div>
        <div class="lq-race-time">4.3 ms</div>
      </div>
      <div class="lq-race-row lq-race-row--us">
        <div class="lq-race-name"><code>computedList</code></div>
        <div class="lq-race-bar"><div class="lq-race-fill" style="width: 0.08%"></div></div>
        <div class="lq-race-time">0.014 ms</div>
      </div>
      <div class="lq-race-frame" aria-hidden="true"><span>one 60 fps frame · 16.7 ms</span></div>
    </div>
    <p class="lq-race-note">The bar's full width is one frame at 60 fps. <code>stableComputed</code> spends two thirds of the frame on one checkbox. <code>computedList</code> spends less than a thousandth of it.</p>
  </div>

  <div class="lq-table-wrap">
  <table class="lq-table">
    <thead>
      <tr><th>10,000 tasks: one change, then one read</th><th><code>computedList</code></th><th><code>stableComputed</code></th><th>TanStack DB</th></tr>
    </thead>
    <tbody>
      <tr><td>Complete a task inside the top 10</td><td>0.017 ms</td><td>13.8 ms</td><td>5.2 ms</td></tr>
      <tr><td>Move a task within the sorted list</td><td>0.019 ms</td><td>10.1 ms</td><td>8.7 ms</td></tr>
      <tr><td>Add or remove a task</td><td>0.028 ms</td><td>11.6 ms</td><td>4.3 ms</td></tr>
      <tr><td>Change 100 tasks at once</td><td>0.67 ms</td><td>12.0 ms</td><td>10.6 ms</td></tr>
      <tr><td>Join to owners: complete a task</td><td>0.020 ms</td><td>11.3 ms</td><td>0.098 ms</td></tr>
      <tr><td>Join to owners: deactivate a user</td><td>0.65 ms</td><td>10.4 ms</td><td>1.3 ms</td></tr>
      <tr><td>Group by owner: complete a task</td><td>0.073 ms</td><td>7.1 ms</td><td>0.11 ms</td></tr>
      <tr class="lq-table-build"><td>Build the list the first time</td><td>27 ms</td><td>23 ms</td><td>57 ms</td></tr>
    </tbody>
  </table>
  </div>

  <div class="lq-features">
    <div class="lq-feature">
      <strong>Joins</strong>
      <code>users.get(task.ownerId)</code>
      <span>Look up related docs by key inside any step.</span>
    </div>
    <div class="lq-feature">
      <strong>One-to-many</strong>
      <code>tasks.getAll(user.id)</code>
      <span>Every doc with a key, in source order.</span>
    </div>
    <div class="lq-feature">
      <strong>Groups</strong>
      <code>.groupBy((t) => t.ownerId)</code>
      <span>A change moves one row between groups. No regrouping.</span>
    </div>
    <div class="lq-feature">
      <strong>Paging</strong>
      <code>.offset(20).limit(10)</code>
      <span>Pass a function to make the page itself reactive.</span>
    </div>
    <div class="lq-feature">
      <strong>Rendering</strong>
      <code>&lt;For each={openTasks()}&gt;</code>
      <span>Only the rows that changed re-render.</span>
    </div>
    <div class="lq-feature">
      <strong>Silo</strong>
      <code>store.findAllInMemory("task")</code>
      <span>Query every document you have loaded.</span>
    </div>
  </div>

  <p class="benchmark-footnote">Measured in Node with the kernel's <a href="https://github.com/commoncurriculum/supergrain/blob/main/packages/kernel/benchmarks/computed-list.bench.ts" target="_blank" rel="noopener"><code>computed-list.bench.ts</code></a>: mean time per change, one run on one machine. TanStack DB is 1.0 RC1 with the B-tree indexes it asks for, writing as the server would (sync write). Every implementation runs the same edits and must return the same rows before anything is timed. Building the list the first time costs <code>computedList</code> a little more, since it sets up one computed per task.</p>
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

<!--@include: ../packages/kernel/README.md-->

</div>
