import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
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
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    // Exclude readme-validation test from browser mode since it needs Node.js APIs
    exclude: ['**/readme-validation.test.ts'],
  },
  resolve: {
    alias: {
      '@supergrain/core': resolve(__dirname, '../core/src'),
      '@supergrain/react': resolve(__dirname, '../react/src'),
      '@supergrain/store': resolve(__dirname, '../app-store/src'),
    },
  },
})
