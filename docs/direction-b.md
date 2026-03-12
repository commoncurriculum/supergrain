---
layout: home

hero:
  name: Supergrain
  text: Your Store Has Superpowers
  tagline: A single grain of wheat with the strength of a thousand reducers. Fine-grained reactivity that only re-renders what matters.
  image:
    src: /hero-b.svg
    alt: Supergrain — a heroic grain kernel with superpowers
  actions:
    - theme: brand
      text: Get Started →
      link: #features
    - theme: alt
      text: GitHub
      link: https://github.com/commoncurriculum/supergrain

features:
  - icon: 💥
    title: Supercharged Reactivity
    details: Every property is independently tracked. Change one grain, and only the component that eats it re-renders. The rest? Untouched.
  - icon: 🌾
    title: Grown from Mongo
    details: $set, $inc, $push, $pull, $addToSet — farm-to-table update operators that batch automatically and feel instantly familiar.
  - icon: 🦸
    title: One Hook, Hero Mode
    details: useTrackedStore gives you a reactive proxy. No selectors, no memoization, no ceremony. Access a field and you're subscribed.
  - icon: 🔒
    title: Fort Knox Types
    details: Full TypeScript inference from store creation through updates and computed values. Your IDE autocompletes everything.
  - icon: 🌱
    title: Plant and Grow
    details: No providers. No context wrappers. No action creators. Declare a store in one line and use it everywhere.
  - icon: 📦
    title: Grain Silo
    details: A document-oriented collection store with promise-like async loading, built-in caching, and per-record fine-grained subscriptions.
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-c-brand-1: #DC2626;
  --vp-c-brand-2: #B91C1C;
  --vp-c-brand-3: #991B1B;
  --vp-button-brand-bg: #DC2626;
  --vp-button-brand-hover-bg: #B91C1C;
}

.dark {
  --vp-c-brand-1: #EF4444;
  --vp-c-brand-2: #DC2626;
  --vp-c-brand-3: #B91C1C;
  --vp-button-brand-bg: #EF4444;
  --vp-button-brand-hover-bg: #DC2626;
}

.VPHero .name {
  background: linear-gradient(135deg, #F59E0B 0%, #EF4444 50%, #DC2626 100%) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  background-clip: text !important;
}

.VPHero .text {
  font-weight: 800 !important;
  letter-spacing: -0.03em;
}

.VPFeature {
  border: 1px solid transparent !important;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(220, 38, 38, 0.07)) !important;
  transition: all 0.2s ease !important;
}

.VPFeature:hover {
  border-color: #F59E0B !important;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(245, 158, 11, 0.15) !important;
}

.dark .VPFeature {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(239, 68, 68, 0.05)) !important;
}

.VPFeature .title {
  color: #92400E !important;
  font-weight: 700 !important;
}

.dark .VPFeature .title {
  color: #FDE68A !important;
}

.VPFeature .details {
  color: var(--vp-c-text-1) !important;
}

.VPFeature .icon {
  font-size: 2rem !important;
}
</style>
