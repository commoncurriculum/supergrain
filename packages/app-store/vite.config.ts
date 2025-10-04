import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'SupergrainAppStore',
      formats: ['es', 'cjs'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['@supergrain/core'],
      output: {
        globals: {
          '@supergrain/core': 'SupergrainCore',
        },
      },
    },
  },
  plugins: [
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],
})
