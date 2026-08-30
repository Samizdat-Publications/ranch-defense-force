/**
 * Atlas sprites inside DOM elements.
 *
 * The screens are DOM, not canvas, so a card cannot just blit a frame. This
 * points a div's `background-image` at the same `atlas.png` the renderer uses
 * and positions it by the frame's rect — a CSS sprite sheet, with the atlas we
 * already generate standing in for a hand-built one.
 *
 * The alternative was a `<canvas>` per card, which means a context, a draw call
 * and a resize path for every offer on screen, to show one static 20px picture.
 *
 * Everything degrades to nothing: no atlas, no sprite, and the card is the text
 * card it was before.
 */
import type { Atlas } from '../core/atlas'

let atlas: Atlas | null = null
let atlasUrl = ''

/** Called once the atlas resolves. Before this, sprites are simply absent. */
export function setSpriteAtlas(a: Atlas | null, url: string): void {
  atlas = a
  atlasUrl = url
}

/**
 * A div showing one atlas frame, scaled to fit `box` pixels.
 *
 * Scaled by whole pixels wherever it fits, because a 20px-tall gun at 1.7x is
 * a blurry gun and the whole project is on the pixel grid.
 */
export function spriteEl(
  name: string | undefined, box = 40, forceZoom?: number,
): HTMLElement | null {
  if (!name || !atlas) return null
  const f = atlas.get(name)
  if (!f) return null

  const raw = Math.min(box / f.w, box / f.h)
  // Integer zoom above 1; below it, fit rather than vanish. `forceZoom` lets a
  // card pick the zoom that fills its window, which the design chooses per
  // sprite because the generated art is not one size.
  const scale = forceZoom ?? (raw >= 1 ? Math.max(1, Math.floor(raw)) : raw)

  const el = document.createElement('div')
  el.className = 'card-sprite'
  el.style.width = `${Math.round(f.w * scale)}px`
  el.style.height = `${Math.round(f.h * scale)}px`
  el.style.backgroundImage = `url('${atlasUrl}')`
  el.style.backgroundPosition = `${-f.x * scale}px ${-f.y * scale}px`
  el.style.backgroundSize = `${atlas.image.naturalWidth * scale}px ${atlas.image.naturalHeight * scale}px`
  el.style.imageRendering = 'pixelated'
  return el
}

/**
 * Publish the rarity tiers as CSS custom properties, once, at boot.
 *
 * The colours live in `rarity.json` because a tier is a balance knob and a
 * visual language at the same time. Pushing them into `:root` means the
 * stylesheet can use `var(--rarity-epic)` and the two can never disagree —
 * which they would the moment someone tuned a colour in one place only.
 */
export function installRarityTheme(tiers: Record<string, { colour: string; dark: string }>): void {
  const root = document.documentElement
  for (const [id, tier] of Object.entries(tiers)) {
    root.style.setProperty(`--rarity-${id}`, tier.colour)
    root.style.setProperty(`--rarity-${id}-dark`, tier.dark)
  }
}


/**
 * One atlas frame as a standalone data URL, for tiling.
 *
 * `spriteEl` positions a window onto the whole atlas, which is right for a
 * single sprite and catastrophically wrong with `background-repeat` — the
 * repeat tiles the ENTIRE ATLAS, so the home screen's ground band came out as a
 * wall of every sprite in the game. A tiled background needs a texture that
 * contains only the tile.
 *
 * Cached: this is a canvas allocation and a base64 encode, and the callers are
 * screens that rebuild whenever the atlas or the save changes.
 */
const tileCache = new Map<string, string>()

export function spriteTileUrl(name: string): string | null {
  if (!atlas) return null
  const hit = tileCache.get(name)
  if (hit !== undefined) return hit || null

  const f = atlas.get(name)
  if (!f) {
    tileCache.set(name, '')
    return null
  }
  const c = document.createElement('canvas')
  c.width = f.w
  c.height = f.h
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
  const url = c.toDataURL()
  tileCache.set(name, url)
  return url
}

const stripCache = new Map<string, { url: string; cell: number; frames: number } | null>()

/**
 * Compose an animation clip into a horizontal strip, at runtime, from the atlas.
 *
 * WHY THIS EXISTS. `stripActor` in scene.ts animates a strip with CSS
 * `steps()`, and the fifteen strips it can use today were baked as strip PNGs
 * by `npm run anim`. Everything generated since -- the owner's twenty farm
 * animals, their nineteen blighted twins, the cursed roster -- is packed as
 * INDIVIDUAL frames, because that is what the game renderer wants. So the
 * scene could place any of them and animate none of them.
 *
 * Baking strip PNGs for all of them and packing those too would duplicate
 * every frame in the atlas, which already carries 4,774. This composes the
 * strip in a canvas from frames the atlas ALREADY holds, so the cost is one
 * canvas per clip used and the atlas does not grow at all.
 *
 * Frames are laid out on a uniform cell -- the widest frame in the clip -- and
 * each is centred in its cell. That matters: PixelLab frames are trimmed to
 * content, so a walk cycle's frames differ in width by a few pixels, and a
 * strip packed at each frame's own width makes `steps(n)` land off-centre and
 * the animation jitter sideways. Uniform cells are what make the step exact.
 *
 * Returns the url plus the two numbers `actor()` needs, so no caller has to
 * type a sheet width by hand -- the comment on `actor` is explicit that a
 * hand-typed width fails silently by sliding instead of stepping.
 */
export function stripUrl(
  sheet: string, clip: string, dir: string,
): { url: string; cell: number; frames: number } | null {
  const key = `${sheet}.${clip}.${dir}`
  const hit = stripCache.get(key)
  if (hit !== undefined) return hit

  if (!atlas) return null
  const frames = atlas.clipLength(sheet, clip)
  if (!frames || frames < 1) { stripCache.set(key, null); return null }

  const rects = []
  for (let i = 0; i < frames; i++) {
    const f = atlas.get(`${key}.${i}`)
    if (!f) { stripCache.set(key, null); return null }
    rects.push(f)
  }

  // One uniform cell, big enough for the widest and tallest frame.
  let cell = 0
  for (const f of rects) cell = Math.max(cell, f.w, f.h)

  const c = document.createElement('canvas')
  c.width = cell * frames
  c.height = cell
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  rects.forEach((f, i) => {
    ctx.drawImage(
      atlas!.image, f.x, f.y, f.w, f.h,
      Math.round(i * cell + (cell - f.w) / 2),
      Math.round(cell - f.h),
      f.w, f.h,
    )
  })

  const out = { url: c.toDataURL(), cell, frames }
  stripCache.set(key, out)
  return out
}

/** Which clips a sheet publishes, and how many frames each has. */
export function clipsOf(sheet: string): Record<string, number> {
  return atlas?.clipLengths?.[sheet] ?? {}
}

/** The atlas rect for a name, so callers can size a strip from its real width. */
export function frameOf(name: string): { w: number; h: number } | null {
  const f = atlas?.get(name)
  return f ? { w: f.w, h: f.h } : null
}
