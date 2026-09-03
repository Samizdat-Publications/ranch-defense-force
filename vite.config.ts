/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

// Agent worktrees live under .claude/worktrees/ INSIDE the repo, each with its
// own node_modules and its own copy of tests/. Session 22 found both halves of
// that bite: vitest swept every worktree's tests (1029 tests across 45 files
// where the project has 207 in 9), and vite's file watcher indexed four extra
// node_modules trees on a OneDrive-synced disk, which made the dev server take
// ten seconds per module and never finish loading the page.
const AGENT_DIRS = ['**/.claude/**']

export default defineConfig(({ command }) => ({
  // GitHub Pages serves a project site from /<repo>/, but the dev server serves
  // from root — using the Pages base in dev would 404 every asset. Override
  // with VITE_BASE=/ to preview a production build locally.
  base: process.env.VITE_BASE ?? (command === 'build' ? '/ranch-defense-force/' : '/'),
  build: {
    target: 'es2022',
    assetsInlineLimit: 0, // the atlas must stay a real file, never a data URI
  },
  server: {
    port: 5173,
    watch: { ignored: AGENT_DIRS },
  },
  test: {
    exclude: [...configDefaults.exclude, ...AGENT_DIRS],
  },
}))
