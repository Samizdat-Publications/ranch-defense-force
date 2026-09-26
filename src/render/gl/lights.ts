/**
 * The light batch: soft point and cone lights, added into the light buffer.
 *
 * Each light is a quad covering its radius. The falloff is (1 - d^2)^2, which
 * reaches zero at the edge with no visible rim, and a cone light multiplies in
 * a smoothstep on the angle from its direction. Blending is additive, so light
 * pools where sources overlap, and the composite multiplies the scene by the
 * total (plus the sky's ambient and the sun).
 */
import { compile, Uniforms, type GL } from './glutil'

const STRIDE = 12

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosRad;   // x, y, radius, flicker phase
layout(location=2) in vec4 iColor;    // rgb * intensity, squash (y scale of the pool)
layout(location=3) in vec4 iCone;     // dir.xy, cos inner, cos outer (outer <= -1: omni)
uniform vec2 uView;
uniform vec2 uTarget;
out vec2 vLocal;
flat out vec4 vColor;
flat out vec4 vCone;
void main() {
  vec2 local = aCorner * 2.0 - 1.0;
  vLocal = local;
  vec2 world = iPosRad.xy + local * vec2(iPosRad.z, iPosRad.z * iColor.w);
  vec2 p = (world - uView) / uTarget * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  vColor = iColor;
  vCone = iCone;
}`

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vLocal;
flat in vec4 vColor;
flat in vec4 vCone;
uniform float uOut;                   // output scale (below 1 for an 8-bit buffer)
out vec4 oColor;
void main() {
  float d2 = dot(vLocal, vLocal);
  if (d2 >= 1.0) discard;
  float f = 1.0 - d2;
  f *= f;
  if (vCone.w > -1.0) {
    vec2 dir = vLocal / max(1e-4, sqrt(d2));
    float c = dot(dir, vCone.xy);
    f *= smoothstep(vCone.w, vCone.z, c);
  }
  oColor = vec4(vColor.rgb * f * uOut, 1.0);
}`

export class LightBatch {
  private readonly prog: WebGLProgram
  private readonly u: Uniforms
  private readonly vao: WebGLVertexArrayObject
  private readonly buf: WebGLBuffer
  private data: Float32Array
  private capacity: number
  count = 0

  constructor(private readonly gl: GL, initial = 1024) {
    this.prog = compile(gl, VS, FS, 'lights')
    this.u = new Uniforms(gl, this.prog)
    this.capacity = initial
    this.data = new Float32Array(initial * STRIDE)
    const vao = gl.createVertexArray()
    const quad = gl.createBuffer()
    const buf = gl.createBuffer()
    if (!vao || !quad || !buf) throw new Error('LightBatch: allocation failed')
    this.vao = vao
    this.buf = buf
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(a + 1)
      gl.vertexAttribPointer(a + 1, 4, gl.FLOAT, false, STRIDE * 4, a * 16)
      gl.vertexAttribDivisor(a + 1, 1)
    }
    gl.bindVertexArray(null)
  }

  /** An omnidirectional pool. `squash` below 1 flattens it onto the ground. */
  point(x: number, y: number, radius: number, r: number, g: number, b: number, intensity: number, squash = 0.8): void {
    this.cone(x, y, radius, r, g, b, intensity, 0, 1, 0, -2, squash)
  }

  /** A cone of light pointing along `dx, dy` (unit). `inner/outer` are cosines of half-angles. */
  cone(
    x: number, y: number, radius: number, r: number, g: number, b: number, intensity: number,
    dx: number, dy: number, inner: number, outer: number, squash = 1,
  ): void {
    if (radius <= 0 || intensity <= 0) return
    if (this.count >= this.capacity) {
      this.capacity *= 2
      const next = new Float32Array(this.capacity * STRIDE)
      next.set(this.data)
      this.data = next
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buf)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.data.byteLength, this.gl.DYNAMIC_DRAW)
    }
    const d = this.data
    let i = this.count * STRIDE
    d[i++] = x; d[i++] = y; d[i++] = radius; d[i++] = 0
    d[i++] = r * intensity; d[i++] = g * intensity; d[i++] = b * intensity; d[i++] = squash
    d[i++] = dx; d[i++] = dy; d[i++] = inner; d[i] = outer
    this.count++
  }

  /** Draw into the bound light target with additive blending. */
  flush(viewX: number, viewY: number, targetW: number, targetH: number, outScale: number): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.useProgram(this.prog)
    gl.uniform2f(this.u.get('uView'), viewX, viewY)
    gl.uniform2f(this.u.get('uTarget'), targetW, targetH)
    gl.uniform1f(this.u.get('uOut'), outScale)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(null)
    this.count = 0
  }
}
