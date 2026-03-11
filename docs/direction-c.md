---
layout: home

hero:
  name: Supergrain
  text: State, Without the Overhead
  tagline: Create a store. Use it in React. Only what changed re-renders. That's it.
  image:
    src: /hero-c.svg
    alt: Supergrain
  actions:
    - theme: brand
      text: Quick Start →
      link: #features
    - theme: alt
      text: View Source
      link: https://github.com/commoncurriculum/supergrain

features:
  - title: Surgical Re-renders
    details: Access store.count in a component — only that component re-renders when count changes.
  - title: Mongo-Style Operators
    details: "$inc, $set, $push — update state with expressive operators that batch automatically."
  - title: One Hook, Zero Config
    details: useTrackedStore gives you a reactive proxy. No selectors, no setup, no boilerplate.
  - title: TypeScript Native
    details: Full type inference. Your IDE knows every property, every update operator, every return type.
  - title: Composable Effects
    details: Computed values and side effects that automatically track their dependencies.
  - title: Collection Store
    details: First-class document management with promise-like async loading and built-in caching.
---

<style>
:root {
  --vp-home-hero-name-color: #F59E0B;
  --vp-c-brand-1: #F59E0B;
  --vp-c-brand-2: #D97706;
  --vp-c-brand-3: #B45309;
  --vp-button-brand-bg: #1E293B;
  --vp-button-brand-hover-bg: #334155;
  --vp-button-brand-text: #F8FAFC;
}

.VPHero .text {
  font-weight: 300 !important;
  letter-spacing: -0.02em;
}

.VPFeature .title {
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace !important;
  font-size: 0.95em !important;
}
</style>
