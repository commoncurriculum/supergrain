import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'StorableAppStore',
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['@storable/core'],
      output: {
        globals: {
          '@storable/core': 'StorableCore',
        },
      },
    },
  },
  plugins: [dts()],
})
