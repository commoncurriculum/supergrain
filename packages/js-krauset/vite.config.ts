import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // This is the key change:
  // We use aliasing to tell Vite to bundle the local storable packages
  // directly from their source code. This makes the package self-contained
  // and removes the need for a pnpm workspace when you copy this package.
  resolve: {
    alias: {
      '@storable/core': resolve(__dirname, '../core/src/index.ts'),
      '@storable/react': resolve(__dirname, '../react/src/index.ts'),
    },
  },

  build: {
    // The benchmark runner expects predictable, non-hashed file names.
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },

  // The base path must be relative for the benchmark server to find assets correctly.
  base: '',
})
