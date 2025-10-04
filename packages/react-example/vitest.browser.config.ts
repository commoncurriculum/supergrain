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

    globals: true,
  },
  resolve: {
    alias: {
      '@supergrain/core': resolve(__dirname, '../core/src'),
      '@supergrain/react': resolve(__dirname, '../react/src'),
    },
  },
})
