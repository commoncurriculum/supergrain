---
layout: home

hero:
  name: Supergrain
  text: A Field of Reactive State
  tagline: Golden rows of independently tracked properties stretching to the horizon. Only the stalks you touch sway.
  image:
    src: /hero-c.svg
    alt: Supergrain — a golden wheat field representing reactive state
  actions:
    - theme: brand
      text: Get Started →
      link: #features
    - theme: alt
      text: GitHub
      link: https://github.com/commoncurriculum/supergrain

features:
  - icon: 🌾
    title: Every Stalk, Independently Reactive
    details: Properties are tracked individually. Updating one field only re-renders components that read it — the rest of the field stays still.
  - icon: 🌅
    title: Sunset-Simple Updates
    details: MongoDB-style operators — $set, $inc, $push, $pull — make state updates as natural as describing what changed.
  - icon: 🪝
    title: One Hook, Whole Harvest
    details: useTrackedStore returns a reactive proxy. Access any property and you're subscribed. No setup, no selectors, no waste.
  - icon: 🧬
    title: Types Rooted Deep
    details: TypeScript inference flows from store creation through every update operator and computed value. Zero manual annotations.
  - icon: 🌿
    title: Organic Simplicity
    details: No providers, no wrappers, no boilerplate rituals. A store grows from a single line and works everywhere.
  - icon: 🏛️
    title: The Grain Elevator
    details: A document-oriented collection store for app-level data — async loading, caching, and per-record fine-grained tracking baked in.
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-c-brand-1: #D97706;
  --vp-c-brand-2: #B45309;
  --vp-c-brand-3: #92400E;
  --vp-button-brand-bg: #B45309;
  --vp-button-brand-hover-bg: #92400E;
}

.dark {
  --vp-c-brand-1: #FDE68A;
  --vp-c-brand-2: #F59E0B;
  --vp-c-brand-3: #D97706;
  --vp-button-brand-bg: #F59E0B;
  --vp-button-brand-hover-bg: #D97706;
}

.VPHero .name {
  background: linear-gradient(135deg, #FDE68A 0%, #F59E0B 40%, #65A30D 100%) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  background-clip: text !important;
}

.VPHero .text {
  font-weight: 700 !important;
  letter-spacing: -0.03em;
}

.VPFeature {
  border: 1px solid transparent !important;
  background: linear-gradient(180deg, rgba(253, 230, 138, 0.12), rgba(217, 119, 6, 0.08)) !important;
  transition: all 0.2s ease !important;
}

.VPFeature:hover {
  border-color: #D97706 !important;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(217, 119, 6, 0.15) !important;
}

.dark .VPFeature {
  background: linear-gradient(180deg, rgba(253, 230, 138, 0.06), rgba(217, 119, 6, 0.03)) !important;
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
