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
  },
  resolve: {
    alias: {
      '@storable/core': resolve(__dirname, '../core/src'),
      '@storable/react': resolve(__dirname, '../react/src'),
      '@storable/app-store': resolve(__dirname, '../app-store/src'),
    },
  },
})
