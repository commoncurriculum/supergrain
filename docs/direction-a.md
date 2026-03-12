---
layout: home

hero:
  name: Supergrain
  text: Harvest the Power of Fine-Grained Reactivity
  tagline: Plant a store, watch only what grows. Supergrain tracks every field you touch and re-renders nothing else.
  image:
    src: /hero-a.svg
    alt: Supergrain — a wheat ear representing fine-grained reactivity
  actions:
    - theme: brand
      text: Get Started →
      link: #features
    - theme: alt
      text: GitHub
      link: https://github.com/commoncurriculum/supergrain

features:
  - icon: 🌾
    title: Grain-Level Reactivity
    details: Each property is a grain. Touch one, and only the component that reads it re-renders. Everything else stays dormant.
  - icon: ⚡
    title: Mongo-Powered Updates
    details: $set, $inc, $push, $pull — expressive batch operations that feel like writing to a database, not wrestling with reducers.
  - icon: 🪝
    title: One Hook to Reap
    details: useTrackedStore auto-subscribes to exactly the fields you access. No selectors. No memoization. Just read and go.
  - icon: 🛡️
    title: TypeScript from Seed to Harvest
    details: Full type inference across stores, updates, and computed values. Your IDE completes every field and operator.
  - icon: 🚜
    title: Zero Plumbing
    details: No providers, no actions, no dispatch, no context wrappers. Create a store. Use it. Done.
  - icon: 🏪
    title: Document Silo
    details: A built-in collection store for managing records with promise-like async loading, caching, and fine-grained subscriptions.
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-c-brand-1: #D97706;
  --vp-c-brand-2: #B45309;
  --vp-c-brand-3: #92400E;
  --vp-button-brand-bg: #D97706;
  --vp-button-brand-hover-bg: #B45309;
}

.dark {
  --vp-c-brand-1: #F59E0B;
  --vp-c-brand-2: #D97706;
  --vp-c-brand-3: #B45309;
  --vp-button-brand-bg: #F59E0B;
  --vp-button-brand-hover-bg: #D97706;
}

.VPHero .name {
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #65A30D 100%) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  background-clip: text !important;
}

.VPHero .text {
  font-weight: 700 !important;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1) !important;
}

.VPFeature {
  border: 1px solid transparent !important;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(101, 163, 13, 0.08)) !important;
  transition: all 0.2s ease !important;
}

.VPFeature:hover {
  border-color: #F59E0B !important;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(245, 158, 11, 0.15) !important;
}

.dark .VPFeature {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(101, 163, 13, 0.05)) !important;
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
