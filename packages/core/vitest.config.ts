import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Most core tests run in a 'node' environment.
    // This benchmark file, however, uses @testing-library/react and needs a DOM.
    environmentMatchGlobs: [['tests/foreach-benchmark.test.tsx', 'jsdom']],
  },
})
