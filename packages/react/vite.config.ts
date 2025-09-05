import { defineConfig } from 'vite'

import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: '@storable/react',
      fileName: format => `index.${format}.js`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['react', '@storable/core'],
      output: {
        globals: {
          react: 'React',
          '@storable/core': 'storableCore',
        },
      },
    },
  },
})
