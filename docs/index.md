---
layout: page
---

<div class="hero-section">
  <div class="hero-content">
    <p class="hero-eyebrow">Reactive state for React</p>
    <h1 class="hero-title">Supergrain</h1>
    <p class="hero-tagline">The most performant and ergonomic state library for React.</p>
    <div class="hero-bullets">
      <div class="hero-bullet"><span class="bullet-icon">&#x2192;</span> Mutate state directly — no actions, reducers, or selectors</div>
      <div class="hero-bullet"><span class="bullet-icon">&#x2192;</span> Only re-renders the component that read the changed property</div>
      <div class="hero-bullet"><span class="bullet-icon">&#x2192;</span> Full TypeScript inference, ~5kb gzipped</div>
    </div>
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
