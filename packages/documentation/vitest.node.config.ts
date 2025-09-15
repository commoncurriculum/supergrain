import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/readme-validation.test.ts'],
  },
  resolve: {
    alias: {
      '@storable/core': resolve(__dirname, '../core/src'),
      '@storable/react': resolve(__dirname, '../react/src'),
      '@storable/app-store': resolve(__dirname, '../app-store/src'),
    },
  },
})
