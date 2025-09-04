/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    react(),
    vue(),
    dts({
      insertTypesEntry: true,
      outDir: 'dist',
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'react/index': resolve(__dirname, 'src/react/index.ts'),
        'vue/index': resolve(__dirname, 'src/vue/index.ts'),
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'vue', '@preact/signals-core'],
      output: {
        globals: {
          react: 'React',
          'react/jsx-runtime': 'jsxRuntime',
          vue: 'Vue',
          '@preact/signals-core': 'signals',
        },
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        'dist/',
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
    },
  },
})
