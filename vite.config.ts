import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  // GitHub Pages serves a project site from /<repo>/, but the dev server serves
  // from root — using the Pages base in dev would 404 every asset. Override
  // with VITE_BASE=/ to preview a production build locally.
  base: process.env.VITE_BASE ?? (command === 'build' ? '/ranch-defense-force/' : '/'),
  build: {
    target: 'es2022',
    assetsInlineLimit: 0, // the atlas must stay a real file, never a data URI
  },
  server: { port: 5173 },
}))
