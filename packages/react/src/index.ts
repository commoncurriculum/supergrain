// Main entry point for @supergrain/react

// Export For component for optimized array rendering
export { For } from './use-store'

// Export tracked() component wrapper for per-component signal scoping
export { tracked } from './tracked'

// Export direct DOM binding hook and $$ sigil
export { $$, useDirectBindings, type DirectBinding } from './use-direct-bindings'

// Export DirectFor component for template-based list rendering
export { DirectFor } from './direct-for'

// Re-export all core functionality to ensure users have access to everything
export * from '@supergrain/core'
