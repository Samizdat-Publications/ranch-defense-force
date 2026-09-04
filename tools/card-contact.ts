/**
 * Photograph EVERY card the game can deal, through the real card UI.
 *
 *     npm run cards -- [out.png] [what]
 *     npm run cards -- docs/progress/cards-items.png items
 *     npm run cards -- docs/progress/cards-weapons.png weapons
 *
 * `what` is `items`, `weapons` or `all` (the default).
 *
 * ## Why this exists
 *
 * `cardSprite` is a string in a JSON file. Nothing checks that the key it names
 * is the art the thing IS — only that it resolves, and every atlas key resolves
 * to something. So a card can point at a stand-in for months and typecheck,
 * pass 207 tests, and render a rock where a salt lick belongs.
 *
 * It did. The 2026-09-03 inventory audit found seven items drawing borrowed art
 * while their own generated icons sat packed in the atlas — `saltLick` and
 * `saltCircle` both on `node.rockSmall`, `barbedWire` on a silver ore node,
 * `keroseneCan` on a slop bucket — and five firearms carding off an 8x4 corner
 * of the bundled gun sheet. None of that is visible in source and none of it is
 * visible in a test. It is only visible by LOOKING, which is the lesson session
 * 20 wrote down and this is the instrument for the card surface.
 *
 * Built the way `npm run scene` is built: the real dev server, the real
 * browser, the real `card()` from `src/ui/card.ts` reading the real content.
 * A second implementation that agrees with itself proves nothing.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const out = process.argv[2] ?? 'tools/cards.png'
const what = process.argv[3] ?? 'all'
if (!['items', 'weapons', 'all'].includes(what)) {
  throw new Error(`unknown set '${what}' — expected items, weapons or all`)
}
const PORT = 5197

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
const url = `http://localhost:${PORT}/`

await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite did not start in 60s')), 60_000)
  const onData = (b: Buffer) => {
    if (b.toString().includes('ready in') || b.toString().includes('Local:')) {
      clearTimeout(timer); resolve()
    }
  }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
})

/* Same browser resolution as tools/scene-shot.ts — see the comment there. */
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
const browser = await chromium.launch(exe ? { executablePath: exe } : {})

try {
  const page = await browser.newPage({ viewport: { width: 1760, height: 1200 } })
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(String(e)))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('.home-scene, .phome-scene, .home-yard', { timeout: 180_000 })
  /*
     Wait for the ATLAS, not for the menu.

     `main.ts` opens the menu and THEN loads the atlas in the background — "a
     missing atlas costs you the art, not the game". So `.home-scene` is on
     screen a long time before `setSpriteAtlas` has run, and a contact sheet
     shot at that moment reports every single card as drawing nothing. It did:
     56 of 56, which is the shape of a tool bug rather than a content bug, and
     is worth remembering as the tell.
  */
  await page.waitForFunction('!!window.rdf && !!window.rdf.atlas', undefined, { timeout: 180_000 })

  /*
     Handed to the page as a STRING, not as a function.

     vite-node transforms this file before running it, and one of the things it
     transforms is `import(...)` — into `__vite_ssr_dynamic_import__`, its own
     server-side loader. A function body that goes over the wire to the browser
     is transformed too, and the browser has no such symbol: every run died with
     `__vite_ssr_dynamic_import__ is not defined` inside the evaluate. A string
     is opaque to the transform, which is the whole reason it is one.
  */
  const SCRIPT = `(async (set) => {
    const [cardMod, content] = await Promise.all([
      import('/src/ui/card.ts'),
      import('/src/content/index.ts'),
    ])
    const card = cardMod.card
    const ITEMS = content.ITEMS
    const WEAPONS = content.WEAPONS
    const itemCardSprite = content.itemCardSprite
    const weaponCardSprite = content.weaponCardSprite

    document.body.innerHTML = ''
    /*
       The app's own page chrome has to be undone, not just emptied.

       index.html puts #stage at \`position: fixed; inset: 0\` and the stylesheet
       gives html/body \`overflow: hidden\` and a viewport height — which is right
       for a letterboxed game and wrong for a contact sheet. A fullPage
       screenshot of it returns exactly one viewport of cards and silently drops
       the rest; the first run of this tool showed four and a half rows of
       fifty-six cards and looked like a complete sheet.
    */
    document.documentElement.style.cssText = 'height:auto;overflow:visible'
    document.body.style.cssText =
      'position:static;height:auto;min-height:0;max-height:none;overflow:visible;'
      + 'background:#14110d;padding:18px;display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start'

    const blank = []
    const add = (kind, id, def, sprite) => {
      const node = card({
        kind,
        name: String(def.name ?? id),
        sprite,
        rarity: def.rarity,
        lot: id,
        source: sprite,
      })
      if (!node.querySelector('.pcard-window .card-sprite')) blank.push(id + ' -> ' + sprite)
      document.body.append(node)
    }
    if (set !== 'weapons') {
      for (const [id, def] of Object.entries(ITEMS)) {
        if (id.startsWith('_') || typeof def !== 'object' || def === null) continue
        add('ITEM', id, def, itemCardSprite(id))
      }
    }
    if (set !== 'items') {
      for (const [id, def] of Object.entries(WEAPONS)) {
        if (id.startsWith('_') || typeof def !== 'object' || def === null) continue
        add('WEAPON', id, def, weaponCardSprite(id, 1))
      }
    }
    // The deal animation starts cards transparent; this is a contact sheet, not
    // a demo, so land every one of them before the shutter.
    for (const c of Array.from(document.querySelectorAll('.pcard'))) {
      c.style.opacity = '1'
      c.style.transform = 'none'
      c.style.animation = 'none'
    }
    for (const s of Array.from(document.querySelectorAll('.pcard-stat, .pcard-blurb'))) {
      s.style.animation = 'none'
    }
    return blank
  })(${JSON.stringify(what)})`

  const missing = await page.evaluate(SCRIPT) as string[]

  await page.waitForTimeout(400)
  mkdirSync(dirname(out), { recursive: true })
  /*
     Size the viewport to the content and shoot the viewport.

     `fullPage: true` is the obvious call and it does not work here: it measures
     the SCROLLING box, and this page's html/body are still governed by the
     app's stylesheet under a `#stage` that was `position: fixed`. It returned a
     tall image with one viewport of cards at the top and the app's navy
     background under the rest. Asking the layout how tall the card list
     actually is, and then making the window that tall, has no such argument
     with the stylesheet.
  */
  const h = await page.evaluate(
    'Math.ceil(document.body.getBoundingClientRect().height) + 36',
  ) as number
  await page.setViewportSize({ width: 1760, height: Math.max(400, Math.min(h, 16000)) })
  await page.waitForTimeout(150)
  await page.screenshot({ path: out })
  const n = await page.locator('.pcard').count()
  console.log(`${n} cards -> ${out}`)
  if (missing.length) {
    console.error(`\n${missing.length} card(s) draw NOTHING — the key does not resolve:`)
    for (const m of missing) console.error(`  ${m}`)
  }
  if (problems.length) {
    console.error('\npage errors:')
    for (const p of problems) console.error(`  ${p}`)
  }
  if (missing.length || problems.length) process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
}
