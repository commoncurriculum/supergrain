// Main entry point for @supergrain/react

// Export For component for optimized array rendering
export { For } from "./for";

// Export tracked() component wrapper for per-component signal scoping
export { tracked } from "./tracked";

// Export useComputed hook for derived signal values with firewall behavior
export { useComputed } from "./use-computed";

// Export useReactive for per-component reactive state
export { useReactive } from "./use-reactive";

// Export createStore for app-wide reactive state with Provider + hook
export { createStore } from "./create-store";

// Export useSignalEffect for signal-tracked side effects tied to component lifecycle
export { useSignalEffect } from "./use-signal-effect";
