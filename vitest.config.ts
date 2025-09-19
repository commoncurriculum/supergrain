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
      // Node environment for app-store tests
      {
        test: {
          include: ['packages/app-store/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
        resolve: {
          alias: {
            '@storable/core': resolve(__dirname, './packages/core/src'),
            '@storable/app-store': resolve(__dirname, './packages/app-store/src'),
          },
        },
      },
      // Temporarily disable browser tests - React tests need browser environment
      // which requires Playwright browsers to be installed. Uncomment when browsers are available.
    ],
  },
})
