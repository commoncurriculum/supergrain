// Main entry point for @supergrain/react

// Export For component for optimized array rendering
export { For } from "./use-store";

// Export tracked() component wrapper for per-component signal scoping
export { tracked } from "./tracked";

// Export useComputed hook for derived signal values with firewall behavior
export { useComputed } from "./use-computed";

// Export useReactive for per-component reactive state
export { useReactive } from "./use-reactive";

// Export StoreProvider + useStore for app-wide reactive state (singleton default).
// Export createStoreContext for isolated stores (libraries, micro-frontends).
// Export StoreRegistry/RegisteredStore for module-augmentation typing.
export {
  StoreProvider,
  useStore,
  createStoreContext,
  type StoreRegistry,
  type RegisteredStore,
} from "./create-store";

// Export useSignalEffect for signal-tracked side effects tied to component lifecycle
export { useSignalEffect } from "./use-signal-effect";
