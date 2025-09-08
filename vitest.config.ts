import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Node environment for core tests (default)
      {
        name: 'node',
        test: {
          include: ['packages/core/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      // jsdom environment for React tests
      {
        name: 'jsdom',
        test: {
          include: [
            'packages/react/**/*.test.{ts,tsx}',
            'packages/react-example/**/*.test.{ts,tsx}',
          ],
          environment: 'jsdom',
        },
      },
    ],
  },
})
