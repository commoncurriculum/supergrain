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
      <span class="stat-value">~2kb</span>
      <span class="stat-label">gzipped</span>
    </div>
    <div class="stat">
      <span class="stat-value">0</span>
      <span class="stat-label">dependencies</span>
    </div>
    <div class="stat">
      <span class="stat-value">100%</span>
      <span class="stat-label">TypeScript</span>
    </div>
  </div>
</div>

<div class="readme-content">

<!--@include: ../README.md-->

</div>
