// Main entry point for @supergrain/react

// Export the working hooks with proxy-based isolation
export { useTracked, For } from './use-store'

// Export direct DOM binding hook and $$ sigil
export { $$, useDirectBindings, type DirectBinding } from './use-direct-bindings'

// Re-export all core functionality to ensure users have access to everything
export * from '@supergrain/core'
