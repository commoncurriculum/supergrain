---
"@supergrain/core": patch
"@supergrain/react": patch
---

Optimize benchmark performance (-6% weighted across all 9 Krause benchmarks)

- **tracked()**: Remove useRef hook, store effect state on dispatch function. Reduces per-component hook count from 3 to 2.
- **For component**: Cache React elements by raw object identity in the parent path. Unchanged items hit React's `prevElement === nextElement` fast path, skipping memo comparison.
- **For component**: Replace `useLayoutEffect` with `useIsomorphicLayoutEffect` for SSR safety. Remove `CachedForItem` in favor of direct children calls in the parent path.
- **Core**: Add `getNodesIfExist()` fast path for hot loops. Add early primitive return in `wrap()`.
- **Profiler**: Remove unused `effectFires` counter and `profiledEffect` wrapper. Export `effect` directly from alien-signals.
