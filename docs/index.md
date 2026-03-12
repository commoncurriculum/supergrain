---
layout: page
---

<div class="hero-section">
  <div class="hero-content">
    <h1 class="hero-title">Supergrain</h1>
    <p class="hero-tagline">Primitives for building blazing-fast reactive apps without the ceremony.</p>
    <div class="hero-actions">
      <a href="#quick-start" class="btn-primary">Get Started</a>
      <a href="https://github.com/commoncurriculum/supergrain" class="btn-secondary">GitHub</a>
    </div>
  </div>
  <div class="hero-image">
    <img src="/mascot.jpg" alt="Supergrain mascot" class="mascot" />
  </div>
</div>

<div class="features-strip">
  <div class="feature">
    <div class="feature-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    </div>
    <div class="feature-text">
      <strong>Performant</strong>
      <span>Only re-renders what actually changed. Not the parent. Not siblings. Just that one property.</span>
    </div>
  </div>
  <div class="feature">
    <div class="feature-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
    </div>
    <div class="feature-text">
      <strong>Ergonomic</strong>
      <span>Just mutate state directly. No actions, reducers, selectors, or dispatch. It just works.</span>
    </div>
  </div>
</div>

<div class="showcase">
  <div class="showcase-code">
    <div class="showcase-label">The whole API</div>

```tsx
// Create a store
const store = createStore({ count: 0, user: { name: 'Jane' } })

// Use it in React
function Counter() {
  const state = useStore(store)
  return <button onClick={() => state.count++}>{state.count}</button>
}

// That's it. When count changes, only Counter re-renders.
// Not the parent. Not siblings. Just this component.
```

  </div>
  <div class="showcase-stats">
    <div class="stat">
      <span class="stat-value">2x</span>
      <span class="stat-label">faster deep updates than Zustand</span>
    </div>
    <div class="stat">
      <span class="stat-value">0</span>
      <span class="stat-label">selectors to write</span>
    </div>
    <div class="stat">
      <span class="stat-value">~2kb</span>
      <span class="stat-label">gzipped</span>
    </div>
  </div>
</div>

<div class="perf-comparison">
  <h3>Performance: Solid.js-level speed</h3>
  <p class="perf-subtitle">Reactive property reads at scale (10K operations)</p>
  
  <div class="perf-bars">
    <div class="perf-row">
      <span class="perf-label">Supergrain</span>
      <div class="perf-bar-container">
        <div class="perf-bar supergrain" style="width: 90%"></div>
        <span class="perf-time">0.097μs/read</span>
      </div>
    </div>
    <div class="perf-row">
      <span class="perf-label">Non-reactive</span>
      <div class="perf-bar-container">
        <div class="perf-bar baseline" style="width: 60%"></div>
        <span class="perf-time">0.067μs/read</span>
      </div>
    </div>
  </div>
  
  <p class="perf-overhead"><strong>1.5x overhead</strong> — near-native performance with full reactivity</p>
  
  <div class="perf-table">
    <table>
      <thead>
        <tr>
          <th>Operation</th>
          <th>Performance</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Reactive reads</td>
          <td><strong>1.5x</strong> overhead vs non-reactive</td>
        </tr>
        <tr>
          <td>Array push (100 items)</td>
          <td><strong>0.52ms</strong> with batching</td>
        </tr>
        <tr>
          <td>Array splice (50 items)</td>
          <td><strong>1.26ms</strong> efficient updates</td>
        </tr>
        <tr>
          <td>Memory per store</td>
          <td><strong>~1KB</strong></td>
        </tr>
      </tbody>
    </table>
  </div>
  
  <div class="perf-explanation">
    <p><strong>Why is it fast?</strong> We use the same techniques as Solid.js:</p>
    <ul>
      <li>Lazy signal creation — only create signals for accessed properties</li>
      <li>Direct object mutation — no copying, no spread operators</li>
      <li>Batched updates — array operations are grouped efficiently</li>
      <li>Dual caching — symbol + WeakMap for instant proxy lookups</li>
    </ul>
  </div>
  
  <p class="perf-source">Source: <a href="https://github.com/commoncurriculum/supergrain/blob/main/notes/planning/performance-plan-v2.md">notes/planning/performance-plan-v2.md</a></p>
</div>

<div class="readme-content">

<!--@include: ../README.md-->

</div>
