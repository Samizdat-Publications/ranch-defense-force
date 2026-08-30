/**
 * Reconstruct the screenshots nobody kept, by building old commits.
 *
 *     npm run snaphist -- <ref>=<slug> ...
 *     npm run snaphist -- --list          what is worth reconstructing
 *
 * ## What this can and cannot do
 *
 * It CANNOT recover a contemporary screenshot, because none was taken. What it
 * does is check a commit out into a throwaway git worktree, pack that commit's
 * atlas from that commit's `assets/`, and run that commit's own screenshot
 * tool. The result is what the project looked like at that commit, produced by
 * the code and art of that commit.
 *
 * The one thing it is not is a photograph. Say so wherever the images are shown
 * — `LOG.md` does.
 *
 * ## Why a worktree
 *
 * **The main tree is never touched.** `git checkout` of an old commit with
 * uncommitted work is how a session's work gets lost, and this project runs
 * with a large dirty tree for days at a time. `git worktree add --detach`
 * gives the old commit its own directory, and it is removed afterwards whether
 * the build worked or not.
 *
 * ## The worktree gets its OWN node_modules, and that is the second lesson
 *
 * The first version junctioned the main tree's `node_modules` in to save an
 * install per commit. `git worktree remove --force` then walked the tree,
 * followed the junction, and **deleted the main tree's `node_modules/.bin`** —
 * every shim, so `npm run typecheck` stopped working mid-session. A junction is
 * not a boundary, and a cleanup that can reach outside the thing it is cleaning
 * is not a cleanup.
 *
 * Running the main tree's `vite-node` with `cwd` in the worktree was the next
 * attempt and it does not work either: vite resolves its own plugins from the
 * project root it is pointed at, so it dies with ERR_MODULE_NOT_FOUND.
 *
 * So each worktree installs. `--prefer-offline` makes it a cache copy rather
 * than a download, and it costs under a minute per commit. It is slower than a
 * link and it cannot delete anything it does not own, which is the trade worth
 * making on a tool whose entire job is to touch old commits.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const ROOT = resolve('.')
const ARCHIVE = 'docs/progress'
/**
 * vite-node's ESM entry, run through node directly.
 *
 * NOT `npx`. On Windows `npx` is a `.cmd` shim and `execFileSync` without a
 * shell cannot execute one — it fails with a bare ENOENT and an empty stderr,
 * which is a genuinely confusing five minutes. Going through `process.execPath`
 * needs no shell at all, which is also what keeps a caption with a quote in it
 * from becoming a command.
 */
const VITE_NODE = 'node_modules/vite-node/vite-node.mjs'
/** Relative: each worktree has its own install, so this resolves inside it. */
const ABS_VITE_NODE = VITE_NODE


const git = (args: string[], cwd = ROOT): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

if (argv.includes('--list') || argv.length === 0) {
  console.log('Commits worth a reconstruction — pass them as <ref>=<slug>:\n')
  console.log(git(['log', '--oneline', '--reverse', '-40']))
  console.log('\nTags:')
  console.log(git(['tag', '-l']))
  process.exit(0)
}

for (const spec of argv.filter((a) => !a.startsWith('--'))) {
  const [ref, slug] = spec.split('=')
  if (!ref || !slug) { console.error(`skip ${spec}: want <ref>=<slug>`); continue }

  let sha = ''
  let date = ''
  let subject = ''
  try {
    sha = git(['rev-parse', '--short', ref])
    date = git(['log', '-1', '--format=%ad', '--date=short', ref])
    subject = git(['log', '-1', '--format=%s', ref])
  } catch {
    console.error(`skip ${ref}: no such ref`)
    continue
  }

  const work = mkdtempSync(join(tmpdir(), 'rdf-hist-'))
  console.log(`\n=== ${date}  ${sha}  ${subject}`)
  try {
    git(['worktree', 'add', '--detach', work, ref])

    // Its own, from the npm cache. See the note above for why not a link.
    execFileSync('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'],
      { cwd: work, stdio: 'ignore', shell: true })

    // That commit's atlas, from that commit's assets and manifest.
    execFileSync(process.execPath, [ABS_VITE_NODE, 'tools/build-atlas.ts'], { cwd: work, stdio: 'inherit' })

    // ...and that commit's own screenshot tool. Old signatures differ, so it is
    // called exactly as its own README-era usage line says.
    const out = join(work, 'hist.png')
    execFileSync(process.execPath, [ABS_VITE_NODE, 'tools/screenshot.ts', '--', '3000', out, '20260811', 'hand'],
      { cwd: work, stdio: 'inherit' })

    mkdirSync(ARCHIVE, { recursive: true })
    execFileSync(process.execPath, [
      ABS_VITE_NODE, 'tools/snap.ts', '--', '--add', out, slug,
      `Reconstructed from ${sha} — "${subject}". Built and shot from that commit's own code and art; no screenshot was taken at the time.`,
      '--date', date, '--commit', sha,
    ], { cwd: ROOT, stdio: 'inherit' })
  } catch (e) {
    console.error(`  FAILED: ${(e as Error).message.split('\n')[0]}`)
  } finally {
    /*
       THE JUNCTION COMES OUT FIRST.

       `git worktree remove` walks the tree, and on Windows a directory junction
       to node_modules makes it try to delete several thousand files it does not
       own — it fails with "Permission denied" and leaves the worktree
       registered. Unlinking the junction is a single operation that does not
       touch the target.
    */
    try { git(['worktree', 'remove', '--force', work]) } catch { /* already gone */ }
    try { rmSync(work, { recursive: true, force: true }) } catch { /* held open */ }
    try { git(['worktree', 'prune']) } catch { /* nothing to prune */ }
  }
}
