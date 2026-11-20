// js-framework-benchmark, weighted geometric mean (lower is better).
export const results = [
  { name: "supergrain", score: 1.52, us: true },
  { name: "rxjs", score: 1.53 },
  { name: "tagged-state", score: 1.56 },
  { name: "zustand", score: 1.63 },
  { name: "mobX", score: 1.66 },
  { name: "redux-hooks", score: 1.67 },
  { name: "react-tracked", score: 1.76 },
  { name: "valtio", score: 1.89 },
  { name: "redux", score: 1.98 },
];

export const ingredients = [
  {
    name: "kernel",
    href: "/docs/kernel",
    does: "the store: plain objects, direct writes, React bindings, and live sorted and filtered lists",
  },
  {
    name: "husk",
    href: "/docs/husk",
    does: "side effects with cleanup, such as fetches, subscriptions and timers",
  },
  {
    name: "silo",
    href: "/docs/silo",
    does: "a document cache for your API, with batched requests and Suspense",
  },
  {
    name: "queries",
    href: "/docs/queries",
    does: "paginated and live-updating queries for silo",
  },
  {
    name: "mill",
    href: "/docs/mill",
    does: "MongoDB-style updates like $set and $push, with undo",
  },
];
