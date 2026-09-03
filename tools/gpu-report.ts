/**
 * Ask THIS machine's Chrome what it is actually doing with the canvas.
 *
 *     npm run gpu            -> tools/play/perf-gpu.txt
 *
 * ## Why this exists
 *
 * The handoff's leading hypothesis for the owner's ~2fps is the 4096x8192
 * atlas thrashing a GPU. That hypothesis only has meaning if the 2D canvas is
 * GPU-accelerated at all. Nothing in this repo had ever checked, and no CPU
 * profile can tell you: if Chrome has fallen back to software rasterisation,
 * every `drawImage` is memcpy on the CPU inside `(program)` time and the
 * profile just shows idle.
 *
 * `chrome://gpu` answers it in one line ("Canvas: Hardware accelerated" vs
 * "Software only"). It is read through the SAME `channel: 'chrome'` launch
 * every other measurement tool uses, so the answer is about the browser the
 * measurements ran in, not about some other Chrome on the box.
 *
 * Text, not a screenshot: the feature list is long and the interesting part is
 * a table nobody can read at 1600x900.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { launchBrowser } from './harness.ts'

const out = process.argv[2] ?? 'tools/play/perf-gpu.txt'
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })

const browser = await launchBrowser({ headed: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto('chrome://gpu', { waitUntil: 'load', timeout: 60_000 })
  // The page builds itself from an async mojo call; wait for the status rows.
  await page.waitForFunction(
    `document.body.innerText.includes('Graphics Feature Status')`,
    null,
    { timeout: 60_000 },
  ).catch(() => { /* report whatever is there */ })
  await page.waitForTimeout(1500)
  /*
     `document.body.innerText` returns EMPTY here: chrome://gpu renders inside
     an `<info-view>` custom element's shadow root, and innerText does not
     cross a shadow boundary. Measured: 0 chars. So walk the tree and collect
     the text of every shadow root as well.
  */
  const text = await page.evaluate(`(() => {
    const out = [];
    const walk = (root) => {
      out.push(root.textContent || '');
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of all) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document.body);
    return out.join(String.fromCharCode(10) + '---- shadow root ----' + String.fromCharCode(10));
  })()`) as string
  writeFileSync(out, text)
  console.log(`${text.length} chars -> ${out}`)
  const stop = text.indexOf('Version Information')
  console.log(text.slice(0, stop > 0 ? stop : 2500))
} finally {
  await browser.close()
}
