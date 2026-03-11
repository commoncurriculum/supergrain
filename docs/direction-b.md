---
layout: home

hero:
  name: Supergrain
  text: Reactive Signals, Wired Up
  tagline: A reactive store that tracks property access and updates components with surgical precision. Powered by alien-signals.
  image:
    src: /hero-b.svg
    alt: Supergrain
  actions:
    - theme: brand
      text: Get Started →
      link: #features
    - theme: alt
      text: GitHub
      link: https://github.com/commoncurriculum/supergrain

features:
  - title: Signal-Level Precision
    details: Subscribe at the property level. Only the components that read a value re-render when it changes.
  - title: MongoDB-Style Updates
    details: Use $set, $inc, $push, $pull, and more. Batched by default, expressive by design.
  - title: Drop-In React Hook
    details: useTrackedStore auto-subscribes to accessed properties. No selectors, no memoization hacks.
  - title: Type-Safe End to End
    details: Stores, updates, and computed values are fully typed with zero manual annotations.
  - title: No Ceremony
    details: No providers, no actions, no reducers. Just create a store, read it, update it.
  - title: Document Collections
    details: Manage app-level data with a document-oriented store, promise-like loading, and built-in caching.
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-c-brand-1: #818CF8;
  --vp-c-brand-2: #6366F1;
  --vp-c-brand-3: #4F46E5;
  --vp-button-brand-bg: #6366F1;
  --vp-button-brand-hover-bg: #4F46E5;
}

.VPHero .name {
  background: linear-gradient(135deg, #818CF8, #F59E0B) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  background-clip: text !important;
}

.VPHero .text {
  font-weight: 300 !important;
  letter-spacing: -0.02em;
}
</style>
