# Solid.js Store Architecture

> **Status:** Historical reference. Brief overview of Solid.js's approach, captured during Supergrain's design phase for comparison.
> **Relevance:** Supergrain borrows Solid's core ideas (proxy-wrapped signals, fine-grained DOM updates) but targets React instead of a compiled framework.

## Core Ideas

1. **Fine-grained reactivity** — Signals + effects. Only the specific DOM nodes that depend on changed state update (no virtual DOM diffing).
2. **Compiled JSX** — Solid compiles templates into direct DOM manipulation. The compiler creates a direct mapping from signal to DOM node, eliminating vDOM overhead entirely.
3. **Proxy-wrapped stores** — `createStore` returns a proxy that intercepts property access/mutation and notifies subscriber effects.

## Primitives

- `createSignal()` — getter/setter pair (fundamental reactive unit)
- `createEffect()` — computation that re-runs when dependencies change
- `createStore()` — proxy-wrapped reactive object (tree of signals)
- `produce()` — Immer-style immutable updates on store state

## How It Works

Each store property is backed by a signal. Updating a property calls the signal's setter, which triggers subscribed effects. The compiler knows exactly which DOM nodes to update — no diffing needed.

## Relevance to Supergrain

Supergrain uses the same proxy + signal architecture but cannot rely on compilation for DOM targeting because React owns the render cycle. This is why Supergrain needs `tracked()` (formerly `useTracked`) / version-based subscriptions to bridge signals into React's reconciliation model. See `react-adapter-architecture.md` for details.
