import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  test: {
    projects: [
      // Node environment for core tests (default)
      {
        test: {
          include: ['packages/core/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      // Browser environment for React tests
      {
        plugins: [react()],
        test: {
          include: [
            'packages/react/**/*.test.{ts,tsx}',
            'packages/react-example/**/*.test.{ts,tsx}',
          ],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
          setupFiles: ['./packages/react/tests/setup.ts'],
          globals: true,
        },
        resolve: {
          alias: {
            '@storable/core': resolve(__dirname, './packages/core/src'),
            '@storable/react': resolve(__dirname, './packages/react/src'),
          },
        },
      },
    ],
  },
})
