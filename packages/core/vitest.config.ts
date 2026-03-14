import { defineConfig } from 'vitest/config'
import { supergrain } from '../vite-plugin/src/plugin'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'proxy',
          environmentMatchGlobs: [['tests/foreach-benchmark.test.tsx', 'jsdom']],
        },
      },
      {
        test: {
          name: 'compiled',
          environmentMatchGlobs: [['tests/foreach-benchmark.test.tsx', 'jsdom']],
          exclude: [
            '**/tracking-isolation.test.ts', // Tests proxy-specific useTracked pattern
          ],
        },
        plugins: [supergrain()],
      },
    ],
  },
})
