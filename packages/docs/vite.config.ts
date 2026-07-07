import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import mdx from 'fumadocs-mdx/vite';

export default defineConfig({
  // Served from a GitHub Pages project subpath: https://commoncurriculum.github.io/supergrain/
  base: '/supergrain/',
  plugins: [mdx(), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    external: ['@takumi-rs/image-response'],
  },
});
