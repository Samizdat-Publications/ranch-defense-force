/**
 * The shape batch: untextured triangles with a colour per vertex.
 *
 * Hazard discs and rims, telegraph cones, melee wedges, jab strokes and the
 * burning arena edge. Rasterised at art resolution like everything else, so a
 * circle is a pixel circle, not an antialiased vector one.
 *
 * Colours are passed straight (not premultiplied) and premultiplied in the
 * shader, which is what the world target's blend mode expects.
 */
import { compile, Uniforms, type GL } from './glutil'

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aColor;
uniform vec2 uView;
uniform vec2 uTarget;
out vec4 vColor;
void main() {
  vec2 p = (aPos - uView) / uTarget * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  vColor = aColor;
}`

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vColor;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;
void main() {
  oColor = vec4(vColor.rgb * vColor.a, vColor.a);
  oEmissive = vec4(0.0);
}`

/** Floats per vertex: x, y, r, g, b, a. */
const STRIDE = 6

export class ShapeBatch {
  private readonly prog: WebGLProgram
  private readonly u: Uniforms
  private readonly vao: WebGLVertexArrayObject
  private readonly buf: WebGLBuffer
  private data: Float32Array
  private capacity: number
  /** Vertices queued since the last flush. */
  count = 0
  draws = 0

  constructor(private readonly gl: GL, initialVertices = 65536) {
    this.prog = compile(gl, VS, FS, 'shapes')
    this.u = new Uniforms(gl, this.prog)
    this.capacity = initialVertices
    this.data = new Float32Array(initialVertices * STRIDE)
    const vao = gl.createVertexArray()
    const buf = gl.createBuffer()
    if (!vao || !buf) throw new Error('ShapeBatch: allocation failed')
    this.vao = vao
    this.buf = buf
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * 4, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE * 4, 8)
    gl.bindVertexArray(null)
  }

  private ensure(n: number): void {
    if (this.count + n <= this.capacity) return
    while (this.count + n > this.capacity) this.capacity *= 2
    const next = new Float32Array(this.capacity * STRIDE)
    next.set(this.data)
    this.data = next
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
  }

  private v(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const d = this.data
    const i = this.count * STRIDE
    d[i] = x; d[i + 1] = y; d[i + 2] = r; d[i + 3] = g; d[i + 4] = b; d[i + 5] = a
    this.count++
  }

  tri(
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
    r: number, g: number, b: number, a: number,
  ): void {
    this.ensure(3)
    this.v(x0, y0, r, g, b, a)
    this.v(x1, y1, r, g, b, a)
    this.v(x2, y2, r, g, b, a)
  }

  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
    this.tri(x, y, x + w, y, x, y + h, r, g, b, a)
    this.tri(x + w, y, x + w, y + h, x, y + h, r, g, b, a)
  }

  /** A filled wedge from `a0` to `a1` (radians). A full turn is a disc. */
  wedge(
    cx: number, cy: number, rx: number, ry: number, a0: number, a1: number,
    r: number, g: number, b: number, a: number,
  ): void {
    const span = a1 - a0
    const segs = Math.max(6, Math.ceil(Math.abs(span) * Math.max(rx, ry) / 6))
    let px = cx + Math.cos(a0) * rx
    let py = cy + Math.sin(a0) * ry
    for (let s = 1; s <= segs; s++) {
      const t = a0 + (span * s) / segs
      const nx = cx + Math.cos(t) * rx
      const ny = cy + Math.sin(t) * ry
      this.tri(cx, cy, px, py, nx, ny, r, g, b, a)
      px = nx
      py = ny
    }
  }

  disc(cx: number, cy: number, radius: number, r: number, g: number, b: number, a: number): void {
    this.wedge(cx, cy, radius, radius, 0, Math.PI * 2, r, g, b, a)
  }

  /** A stroked arc of `width` pixels, centred on `radius`. */
  arc(
    cx: number, cy: number, radius: number, a0: number, a1: number, width: number,
    r: number, g: number, b: number, a: number,
  ): void {
    const span = a1 - a0
    const segs = Math.max(8, Math.ceil(Math.abs(span) * radius / 5))
    const r0 = Math.max(0, radius - width / 2)
    const r1 = radius + width / 2
    let c0 = Math.cos(a0)
    let s0 = Math.sin(a0)
    for (let s = 1; s <= segs; s++) {
      const t = a0 + (span * s) / segs
      const c1 = Math.cos(t)
      const s1 = Math.sin(t)
      this.tri(cx + c0 * r0, cy + s0 * r0, cx + c0 * r1, cy + s0 * r1, cx + c1 * r1, cy + s1 * r1, r, g, b, a)
      this.tri(cx + c0 * r0, cy + s0 * r0, cx + c1 * r1, cy + s1 * r1, cx + c1 * r0, cy + s1 * r0, r, g, b, a)
      c0 = c1
      s0 = s1
    }
  }

  ring(cx: number, cy: number, radius: number, width: number, r: number, g: number, b: number, a: number): void {
    this.arc(cx, cy, radius, 0, Math.PI * 2, width, r, g, b, a)
  }

  /** An ellipse outline, for flattened ground rings. */
  ellipseRing(
    cx: number, cy: number, rx: number, ry: number, width: number,
    r: number, g: number, b: number, a: number,
  ): void {
    const segs = Math.max(16, Math.ceil(Math.max(rx, ry) * 1.2))
    const w = width / 2
    let pc = 1
    let ps = 0
    for (let s = 1; s <= segs; s++) {
      const t = (Math.PI * 2 * s) / segs
      const c = Math.cos(t)
      const sn = Math.sin(t)
      this.tri(cx + pc * (rx - w), cy + ps * (ry - w), cx + pc * (rx + w), cy + ps * (ry + w), cx + c * (rx + w), cy + sn * (ry + w), r, g, b, a)
      this.tri(cx + pc * (rx - w), cy + ps * (ry - w), cx + c * (rx + w), cy + sn * (ry + w), cx + c * (rx - w), cy + sn * (ry - w), r, g, b, a)
      pc = c
      ps = sn
    }
  }

  line(
    x0: number, y0: number, x1: number, y1: number, width: number,
    r: number, g: number, b: number, a: number,
  ): void {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * width / 2
    const ny = (dx / len) * width / 2
    this.tri(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x0 - nx, y0 - ny, r, g, b, a)
    this.tri(x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, r, g, b, a)
  }

  flush(viewX: number, viewY: number, targetW: number, targetH: number): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.useProgram(this.prog)
    gl.uniform2f(this.u.get('uView'), viewX, viewY)
    gl.uniform2f(this.u.get('uTarget'), targetW, targetH)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE)
    gl.drawArrays(gl.TRIANGLES, 0, this.count)
    gl.bindVertexArray(null)
    this.count = 0
    this.draws++
  }
}
