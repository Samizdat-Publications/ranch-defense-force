/**
 * Resolve the PixelLab API key from wherever this run already has it.
 *
 *     import { pixellabKey } from './pixellab-key.ts'
 *     const key = pixellabKey()
 *
 * Order:
 *   1. `process.env.PIXELLAB_API_KEY`, if set — unchanged from every other
 *      tool, and still the way to override or to run outside this repo.
 *   2. the repo's gitignored `.mcp.json`, at
 *      `mcpServers.pixellab.headers.Authorization` (`"Bearer <key>"`, prefix
 *      stripped) — the key the PixelLab MCP server already holds, so a worktree
 *      or a fresh shell does not need the env var re-typed by hand.
 *   3. neither is available: throws, naming both places.
 *
 * `.mcp.json` is searched for by walking up from THIS FILE's own directory
 * (not `process.cwd()`, which a worktree or a differently-invoked script
 * cannot be trusted to set) to the filesystem root. A worktree checkout
 * under `.claude/worktrees/<name>/` has no `.mcp.json` of its own — it lives
 * inside the main checkout, so the walk reaches the main checkout's copy
 * without special-casing worktrees at all. If the walk finds nothing (this
 * file moved, or is running from somewhere the walk cannot see the repo),
 * this falls back to `git rev-parse --show-toplevel` and checks there too.
 *
 * Never logs, echoes, or returns anything but the bare key string — masking
 * printed values is the caller's job, not this function's, but this function
 * never prints one itself.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface McpConfig {
  mcpServers?: {
    pixellab?: {
      headers?: {
        Authorization?: string
      }
    }
  }
}

function findUp(startDir: string, filename: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    const candidate = join(dir, filename)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function gitToplevel(startDir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

function readAuthorization(mcpJsonPath: string): string | null {
  let parsed: McpConfig
  try {
    parsed = JSON.parse(readFileSync(mcpJsonPath, 'utf8')) as McpConfig
  } catch {
    return null
  }
  const auth = parsed.mcpServers?.pixellab?.headers?.Authorization
  if (!auth) return null
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : auth
}

export function pixellabKey(): string {
  if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY

  const here = dirname(fileURLToPath(import.meta.url))

  const walked = findUp(here, '.mcp.json')
  if (walked) {
    const key = readAuthorization(walked)
    if (key) return key
  }

  const top = gitToplevel(here)
  if (top) {
    const fallback = join(top, '.mcp.json')
    if (existsSync(fallback) && fallback !== walked) {
      const key = readAuthorization(fallback)
      if (key) return key
    }
  }

  throw new Error(
    'no PixelLab API key found.\n\n'
    + '  checked: the PIXELLAB_API_KEY environment variable\n'
    + '  checked: mcpServers.pixellab.headers.Authorization in .mcp.json '
    + '(walked up from tools/, and at the git toplevel)\n\n'
    + 'set PIXELLAB_API_KEY, or run from a checkout that has .mcp.json with '
    + 'the PixelLab MCP server configured.',
  )
}
