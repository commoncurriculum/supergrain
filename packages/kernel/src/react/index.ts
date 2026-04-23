// Main entry point for @supergrain/kernel/react

// Export For component for optimized array rendering
export { For } from "./for";

// Export tracked() component wrapper for per-component signal scoping
export { tracked } from "./tracked";

// Export useComputed hook for derived signal values with firewall behavior
export { useComputed } from "./use-computed";

// Export useReactive for per-component reactive state
export { useReactive } from "./use-reactive";

// Export createStoreContext for typed store bindings. Call once at module
// scope, destructure, re-export; components import from your module.
export { createStoreContext } from "./create-store";

// Export useSignalEffect for signal-tracked side effects tied to component lifecycle
export { useSignalEffect } from "./use-signal-effect";

// Export useReactivePromise / useReactiveTask for component-scoped async primitives
export { useReactivePromise } from "./use-reactive-promise";
export { useReactiveTask } from "./use-reactive-task";

// Export useResource for general-purpose component-scoped resources
export { useResource } from "./use-resource";

// Export modifier / useModifier for element-scoped setup/teardown
export { modifier, useModifier, type Modifier } from "./modifier";
