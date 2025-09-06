import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
      headless: true,
    },
    environment: 'browser',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@storable/core': resolve(__dirname, '../core/src'),
      '@storable/react': resolve(__dirname, './src'),
    },
  },
})
