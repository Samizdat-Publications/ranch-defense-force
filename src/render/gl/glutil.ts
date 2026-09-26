/**
 * Small WebGL2 helpers: program compilation and render targets.
 *
 * Nothing here knows about the game. The renderer builds everything it needs
 * out of these two things plus the batches beside this file.
 */

export type GL = WebGL2RenderingContext

export function compile(gl: GL, vsSrc: string, fsSrc: string, label: string): WebGLProgram {
  const vs = shader(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vs`)
  const fs = shader(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.fs`)
  const prog = gl.createProgram()
  if (!prog) throw new Error(`${label}: createProgram failed`)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`${label}: link failed: ${gl.getProgramInfoLog(prog)}`)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return prog
}

function shader(gl: GL, type: number, src: string, label: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error(`${label}: createShader failed`)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? ''
    // Number the source so the line in the log can be found.
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)} ${l}`).join('\n')
    throw new Error(`${label}: compile failed:\n${log}\n${numbered}`)
  }
  return s
}

/** Uniform locations for a program, looked up once and cached by name. */
export class Uniforms {
  private readonly cache = new Map<string, WebGLUniformLocation | null>()
  constructor(private readonly gl: GL, private readonly prog: WebGLProgram) {}
  get(name: string): WebGLUniformLocation | null {
    let loc = this.cache.get(name)
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.prog, name)
      this.cache.set(name, loc)
    }
    return loc
  }
}

export interface TargetFormat {
  internal: number
  format: number
  type: number
  filter: number
}

/** A framebuffer with one colour texture. Resized in place. */
export class Target {
  readonly fb: WebGLFramebuffer
  readonly tex: WebGLTexture
  w = 0
  h = 0

  constructor(private readonly gl: GL, private readonly fmt: TargetFormat, w: number, h: number) {
    const fb = gl.createFramebuffer()
    const tex = gl.createTexture()
    if (!fb || !tex) throw new Error('Target: allocation failed')
    this.fb = fb
    this.tex = tex
    this.resize(w, h)
  }

  resize(w: number, h: number): void {
    w = Math.max(1, Math.floor(w))
    h = Math.max(1, Math.floor(h))
    if (w === this.w && h === this.h) return
    const gl = this.gl
    this.w = w
    this.h = h
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, this.fmt.internal, w, h, 0, this.fmt.format, this.fmt.type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.fmt.filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.fmt.filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Target: framebuffer incomplete (${status})`)
  }

  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fb)
    this.gl.viewport(0, 0, this.w, this.h)
  }
}

/**
 * A framebuffer with several colour textures written at once (MRT). The world
 * pass uses two: the colour everything is lit from, and the emissive light
 * that ignores the dark and feeds the bloom.
 */
export class MultiTarget {
  readonly fb: WebGLFramebuffer
  readonly texs: WebGLTexture[]
  w = 0
  h = 0

  constructor(private readonly gl: GL, private readonly fmts: TargetFormat[], w: number, h: number) {
    const fb = gl.createFramebuffer()
    if (!fb) throw new Error('MultiTarget: allocation failed')
    this.fb = fb
    this.texs = fmts.map(() => {
      const t = gl.createTexture()
      if (!t) throw new Error('MultiTarget: allocation failed')
      return t
    })
    this.resize(w, h)
  }

  resize(w: number, h: number): void {
    w = Math.max(1, Math.floor(w))
    h = Math.max(1, Math.floor(h))
    if (w === this.w && h === this.h) return
    const gl = this.gl
    this.w = w
    this.h = h
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    const bufs: number[] = []
    this.fmts.forEach((fmt, i) => {
      gl.bindTexture(gl.TEXTURE_2D, this.texs[i])
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, fmt.filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fmt.filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, this.texs[i], 0)
      bufs.push(gl.COLOR_ATTACHMENT0 + i)
    })
    gl.drawBuffers(bufs)
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`MultiTarget: framebuffer incomplete (${status})`)
  }

  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fb)
    this.gl.viewport(0, 0, this.w, this.h)
  }
}

/** Upload a canvas or image as a plain RGBA texture. */
export function textureFrom(
  gl: GL, src: TexImageSource, filter: number, wrap: number, tex?: WebGLTexture,
): WebGLTexture {
  const t = tex ?? gl.createTexture()
  if (!t) throw new Error('textureFrom: allocation failed')
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
  return t
}

/** Parse `#rrggbb` or `rgba(r, g, b, a)` into 0..1 floats. Called at load, never per frame. */
export function parseColour(css: string): [number, number, number, number] {
  const s = css.trim()
  if (s.startsWith('#')) {
    const hex = s.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const n = parseInt(full.slice(0, 6), 16)
    const a = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a]
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p))
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1]
  }
  return [1, 0, 1, 1]
}
