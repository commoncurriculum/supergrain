import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environmentMatchGlobs: [['tests/foreach-benchmark.test.tsx', 'jsdom']],
  },
})
