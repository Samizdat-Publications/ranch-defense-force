/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

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
  test: {
    // Agent worktrees live under .claude/worktrees/ INSIDE the repo, each with
    // its own copy of tests/. Without this vitest sweeps every one of them --
    // measured: 1029 tests across 45 files where the project has 207 in 9, and
    // a failure in a stale worktree copy reported as a failure of this tree.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
}))
