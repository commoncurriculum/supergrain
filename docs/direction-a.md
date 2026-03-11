---
layout: home

hero:
  name: Supergrain
  text: Surgical Reactivity
  tagline: Fine-grained reactive stores for React. Track only what you use. Update only what changed.
  image:
    src: /hero-a.svg
    alt: Supergrain
  actions:
    - theme: brand
      text: Get Started →
      link: #features
    - theme: alt
      text: GitHub
      link: https://github.com/commoncurriculum/supergrain

features:
  - title: Fine-Grained Tracking
    details: Components subscribe to individual properties. Change one field, re-render one component.
  - title: MongoDB Operators
    details: Update with $set, $inc, $push, $pull — powerful, batched, and familiar.
  - title: Zero Boilerplate
    details: No actions, no reducers, no selectors. Create a store and use it.
  - title: React Integration
    details: One hook — useTrackedStore — handles subscriptions automatically.
  - title: TypeScript-First
    details: Full type inference on stores, updates, and computed values.
  - title: Document Store
    details: Manage collections of records with built-in async loading and caching.
---

<style>
:root {
  --vp-home-hero-name-color: #F59E0B;
  --vp-c-brand-1: #F59E0B;
  --vp-c-brand-2: #D97706;
  --vp-c-brand-3: #B45309;
  --vp-button-brand-bg: #F59E0B;
  --vp-button-brand-hover-bg: #D97706;
}

.VPHero .text {
  font-weight: 300 !important;
  letter-spacing: -0.02em;
}
</style>
