import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.{ts,tsx}'],
    environment: 'node', // Default to node environment
    environmentMatchGlobs: [
      // All tests in packages ending with .tsx should use jsdom
      ['packages/react/**/*.test.{ts,tsx}', 'jsdom'],
      ['packages/react-example/**/*.test.{ts,tsx}', 'jsdom'],
      // A specific file in core also needs the DOM
      ['packages/core/tests/foreach-benchmark.test.tsx', 'jsdom'],
    ],
  },
})
