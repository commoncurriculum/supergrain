import { defineConfig } from 'vite'
import { supergrainModelPlugin } from '../vite-plugin'

export default defineConfig({
  plugins: [supergrainModelPlugin()],
  build: {
    lib: {
      entry: 'src/bench.ts',
      formats: ['es'],
      fileName: 'bench',
    },
    outDir: 'dist',
    rollupOptions: {
      // Don't bundle dependencies — we'll run with node --conditions
      external: [
        'arktype',
        'alien-signals',
        /^@ark\//,
      ],
    },
    minify: false,
    sourcemap: false,
  },
})
