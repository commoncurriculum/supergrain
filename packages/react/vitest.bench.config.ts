import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [
        {
          browser: 'chromium',
        },
      ],
    },
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    include: ['**/*.bench.{ts,tsx}'],
    benchmark: {
      include: ['**/*.bench.{ts,tsx}'],
      reporters: ['verbose'],
    },
  },
  resolve: {
    alias: {
      '@supergrain/core': resolve(__dirname, '../core/src'),
      '@supergrain/react': resolve(__dirname, './src'),
    },
  },
})
