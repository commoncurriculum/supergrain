import dts from 'vite-plugin-dts'
/// <reference types="vitest" />
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    // This is a placeholder and will be overridden in each package's config
    lib: {
      entry: resolve(__dirname, 'packages/core/src/index.ts'),
      name: 'supergrain',
      formats: ['es', 'umd'],
      fileName: format => `supergrain.${format}.js`,
    },
    rollupOptions: {
      // Externalize peer dependencies
      external: ['react', 'vue'],
      output: {
        // Global variables for UMD build
        globals: {
          react: 'React',
          vue: 'Vue',
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/index.ts'],
    },
  },
})
