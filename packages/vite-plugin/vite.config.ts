import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    dts({ insertTypesEntry: true }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: '@supergrain/vite-plugin',
      fileName: format => format === 'cjs' ? 'index.cjs' : `index.${format}.js`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['typescript', 'vite', 'magic-string', 'path', 'fs'],
    },
  },
})
