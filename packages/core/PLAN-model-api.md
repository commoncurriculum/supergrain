# Moved

This plan has been moved to [notes/planning/vite-compiler-plugin-plan.md](../../notes/planning/vite-compiler-plugin-plan.md).

The core readSignal approach described in this plan was proven slower than the proxy. See [notes/research/compiled-reads-investigation.md](../../notes/research/compiled-reads-investigation.md) for the full investigation story. What actually shipped: `createView()` prototype getters + `$$()` direct DOM bindings.
