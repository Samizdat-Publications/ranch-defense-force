/**
 * Boot the REAL app in a REAL browser, for tools that need to watch it run.
 *
 * `tools/draw-world.ts` deliberately reimplements the renderer so a headless
 * shot needs no DOM, and says so in its own header. That is a useful check and
 * it is not a substitute for looking: nothing in `tools/` imports
 * `src/render/renderer.ts`, so until now every gameplay screenshot this
 * project produced came from a second implementation held in step with the
 * first by comments reading "Must match src/render/renderer.ts".
 *
 * This module is the other half — the actual renderer, the actual sim, the
 * actual UI. `scene-shot.ts` photographs a title screen with it and `play.ts`
 * plays a run with it.
 *
 * ## Why headless rather than the editor's browser pane
 *
 * The game loop is `requestAnimationFrame`. A hidden pane never fires one, so
 * the sim sits frozen at wave 1 forever and every input looks ignored --
 * measured, not assumed: a rAF counter in a hidden pane returned zero ticks in
 * a second. `main.ts` already knew, in the comment on `rdf.screens`: "a
 * rAF-driven game loop that a headless pane may never run." Headless Chromium
 * still renders, so it still ticks.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'

/**
 * Start vite on `port` and resolve once it says it is listening.
 *
 * Spawns vite's own entry with THIS node rather than going through `npx`. On
 * Windows the executable is `npx.cmd` and a bare `npx` is ENOENT, which is how
 * the scene tool broke the moment this project moved off the cloud sandbox.
 * `shell: true` would fix the lookup and buy a quoting problem instead -- the
 * checkout lives under a path with a space in it.
 */
export async function startVite(port: number): Promise<ChildProcess> {
  const bin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
  const server = spawn(process.execPath, [bin, '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not start in 60s`)), 60_000)
    const onData = (b: Buffer) => {
      const s = b.toString()
      if (s.includes('ready in') || s.includes('Local:')) { clearTimeout(timer); resolve() }
    }
    server.stdout.on('data', onData)
    server.stderr.on('data', onData)
  })
  return server
}

/**
 * Launch Chromium, finding a pre-installed build rather than pinning a path.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` points at a store whose directories carry the
 * BUILD number the environment shipped, and the npm playwright expects
 * whatever build IT was published against. When those differ playwright says
 * "executable doesn't exist" and downloading may be disabled, so resolve by
 * looking. With no store set, playwright's own default is correct.
 */
export async function launchBrowser(opts: { headed?: boolean } = {}): Promise<Browser> {
  const store = process.env.PLAYWRIGHT_BROWSERS_PATH ?? ''
  const candidates = store
    ? readdirSync(store)
      .filter((d) => d.startsWith('chromium'))
      .flatMap((d) => [
        `${store}/${d}/chrome-linux/chrome`,
        `${store}/${d}/chrome-linux/headless_shell`,
        `${store}/${d}/chrome-win/chrome.exe`,
        `${store}/${d}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
      ])
    : []
  const exe = candidates.find((c) => existsSync(c))
  /*
     Stop Chromium throttling the game loop.

     Headless is not enough on its own: an occluded or backgrounded renderer
     drops `requestAnimationFrame` to a trickle, and this game IS a rAF loop.
     Measured before these flags: 2 ticks in 500ms, i.e. 4fps, which reads as a
     frozen sim rather than a throttled one. The four flags below turn off
     occlusion detection and the two backgrounding heuristics.
  */
  const args = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
  ]
  /*
     Headed by default for anything that has to WATCH the game run.

     Headless Chromium produced 1-2 rAF ticks per 500ms here even with the
     throttling flags off -- it composites on demand, and this game only
     advances when a frame is presented. A headed window composites for real.
     It also means the owner can watch the run happen, which on a local machine
     is the entire point.
  */
  const headless = !opts.headed

  /*
     Headed runs go through the INSTALLED Chrome, not playwright's bundle.

     Measured on this machine: playwright's own
     `chromium-1234/chrome-win64/chrome.exe` is permission-denied and launching
     it fails with `spawn UNKNOWN`. The separate headless-shell binary beside it
     runs fine, which is why headless got further -- and then composited on
     demand and starved the game loop anyway. `channel: 'chrome'` uses the
     Chrome already on the box, which both launches and paints.

     Falls back to the bundle rather than hard-failing, since a machine without
     Chrome installed is the ordinary case elsewhere.
  */
  if (!headless) {
    try {
      return await chromium.launch({ channel: 'chrome', args, headless: false })
    } catch {
      // fall through to the bundled browser
    }
  }
  return chromium.launch(exe ? { executablePath: exe, args, headless } : { args, headless })
}

/** Kill a spawned vite, tolerating a process that has already gone. */
export function stopVite(server: ChildProcess): void {
  try { server.kill('SIGTERM') } catch { /* already gone */ }
}
