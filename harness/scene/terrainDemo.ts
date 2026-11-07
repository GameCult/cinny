// Third-tier terrain spike (off by default; nothing in the app imports this). Standalone page, not shipped.
//
//   pass A, once:   a height map rendered into a float render target (fragment shader, N x N)
//   pass B, frames: a pre-subdivided grid whose vertex shader displaces from that map (no tessellation in WebGL2)
//
// The erosion in pass A is CultMath's Phacelle noise (vendored, unedited, MPL-2.0: Rune Skovbo Johansen's
// Phacelle noise, https://blog.runevision.com/2026/01/) composed into a slope-directed gully filter after the
// description in his "Fast and Gorgeous Erosion Filter" post (https://blog.runevision.com/2026/03/): stripes run
// along the downhill direction, gullies fade toward a peak/valley target by a slope mask, and each octave's
// ridges and creases limit where the next octave reaches. The composition below is ours, written from that
// description; it is not his filter code and has not been compared against it.
//
// Query: ?tier=0|1|2 (grid 128/256/512), ?bench=1 (all three tiers, result in #out and window.__result),
// ?force=half|rgba8|none (take a fallback path), ?w=&h= not needed: the canvas follows the window.
import cultmath from '../../src/app/features/scene/shaders/CultMath.glsl?raw';
import phacelle from '../../src/app/features/scene/shaders/CultMath.Phacelle.glsl?raw';
import { trimGlsl } from '../../src/app/features/scene/cultmathTrim';

const HEADER =
  '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

const TIERS = [
  { grid: 128, tex: 512 },
  { grid: 256, tex: 1024 },
  { grid: 512, tex: 2048 },
];
const SPAN = 2000; // metres across the patch
const HMAX = 256; // metres the normalised height 1.0 stands for

type Format = 'rgba32f' | 'rgba16f' | 'rgba8';

// ---- shaders ---------------------------------------------------------------------------------

const FULLSCREEN_VERT = `${HEADER}
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Height in metres for a world xz, normalised by HMAX and written as float, or packed in two bytes for rgba8.
const HEIGHT_STAGE = `
uniform float uSpan;
in vec2 v_uv;
out vec4 o;

const float BASE_AMP = 60.0;
const float BASE_FREQ = 1.0 / 520.0;
const float BASE_LIFT = 110.0;
const float CELL0 = 160.0;         // metres per Phacelle cell, first octave; halves per octave
const float SIDE_LEN = 3.0;        // stripe wave vector length, radians per cell
const float NORM = 0.5;            // Phacelle normalization (roughness 1 - NORM)
const float SLOPE_REF = 0.55;      // slope at which the steepness mask is full
const float DETAIL = 1.5;          // how far fine gullies reach (pow_inv exponent)
const float AMP0 = 11.0;           // metres of the first octave's gully
const float HLO = 20.0, HHI = 200.0; // altitude range the fade target spans

float easeOut(float t) { t = clamp(t, 0.0, 1.0); return 1.0 - (1.0 - t) * (1.0 - t); }
float powInv(float t, float p) { return 1.0 - pow(1.0 - t, p); }

float height(vec2 xz) {
  // fbm_grad: xyz is the gradient w.r.t. p = (xz * freq, 0), so .xy are the two ground axes.
  vec4 fg = cultmath_fbm_grad(vec3(xz * BASE_FREQ, 0.0), 4, 2.0, 0.45);
  float h = BASE_LIFT + BASE_AMP * fg.w;
  vec2 g = BASE_AMP * BASE_FREQ * fg.xy;
  float target = clamp((h - HLO) / (HHI - HLO) * 2.0 - 1.0, -1.0, 1.0);
  float combi = 1.0;
  float amp = AMP0;
  float cell = CELL0;
  for (int i = 0; i < OCTAVES; i++) {
    float slope = length(g);
    vec2 downhill = slope > 1e-4 ? -g / slope : vec2(1.0, 0.0);
    vec2 across = vec2(-downhill.y, downhill.x);
    // z = 0.5 keeps the 3D cell's z layers to two (z = 0 evaluates three of them).
    CultPhasor ph = cultmath_phacelle(vec3(xz / cell, 0.5), vec3(across * SIDE_LEN, 0.0), 0.0, NORM);
    float mask = easeOut(slope / SLOPE_REF) * combi;
    float faded = mix(target, ph.cos.w, mask);
    h += amp * faded;
    // exact gradient of the gully term (the mask's own derivative is ignored)
    g += amp * mask * ph.cos.xy / cell;
    combi = powInv(combi, DETAIL) * (1.0 - abs(ph.sin.w));
    target = faded;
    amp *= 0.5;
    cell *= 0.5;
  }
  return h;
}

void main() {
  float h = clamp(height((v_uv - 0.5) * uSpan) / ${HMAX.toFixed(1)}, 0.0, 1.0);
#if PACK8
  float q = floor(h * 65535.0 + 0.5);
  o = vec4(floor(q / 256.0) / 255.0, mod(q, 256.0) / 255.0, 0.0, 1.0);
#else
  o = vec4(h, 0.0, 0.0, 1.0);
#endif
}`;

const FETCH = `
uniform sampler2D uHeight;
uniform int uTex;
float hAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(uTex - 1));
  vec4 s = texelFetch(uHeight, t, 0);
#if PACK8
  return (floor(s.r * 255.0 + 0.5) * 256.0 + floor(s.g * 255.0 + 0.5)) / 65535.0 * ${HMAX.toFixed(1)};
#else
  return s.r * ${HMAX.toFixed(1)};
#endif
}`;

const GRID_VERT = `
in vec2 a_uv;
uniform mat4 uViewProj;
uniform float uSpan;
out vec2 v_uv;
out vec3 v_world;
${FETCH}
void main() {
  ivec2 t = ivec2(a_uv * float(uTex - 1) + 0.5);
  float h = hAt(t);
  v_uv = a_uv;
  v_world = vec3((a_uv.x - 0.5) * uSpan, h, (a_uv.y - 0.5) * uSpan);
  gl_Position = uViewProj * vec4(v_world, 1.0);
}`;

const GRID_FRAG = `
in vec2 v_uv;
in vec3 v_world;
uniform vec3 uCamera;
uniform float uSpan;
out vec4 o;
${FETCH}
void main() {
  // normal from the height map itself, so shading carries detail finer than the mesh
  ivec2 t = ivec2(v_uv * float(uTex - 1) + 0.5);
  float texel = uSpan / float(uTex - 1);
  float dx = hAt(t + ivec2(1, 0)) - hAt(t - ivec2(1, 0));
  float dz = hAt(t + ivec2(0, 1)) - hAt(t - ivec2(0, 1));
  vec3 n = normalize(vec3(-dx, 2.0 * texel, -dz));
  vec3 sun = normalize(vec3(0.55, 0.62, 0.35));
  float lit = max(dot(n, sun), 0.0);
  float alt = clamp(v_world.y / 200.0, 0.0, 1.0);
  vec3 rock = mix(vec3(0.30, 0.27, 0.24), vec3(0.62, 0.58, 0.52), alt);
  vec3 grass = mix(vec3(0.20, 0.30, 0.16), vec3(0.42, 0.44, 0.28), alt);
  vec3 col = mix(rock, grass, smoothstep(0.55, 0.9, n.y)) * (0.18 + 0.95 * lit);
  float d = length(v_world - uCamera);
  col = mix(col, vec3(0.45, 0.58, 0.70), 1.0 - exp(-d * 0.00035));
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

// ---- GL plumbing -----------------------------------------------------------------------------

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

function program(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'a_uv');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

/** The float formats this context can render to and sample, best first; rgba8 always works. */
function formats(gl: WebGL2RenderingContext, force: string | null): Format[] {
  const full = !!gl.getExtension('EXT_color_buffer_float');
  const half = full || !!gl.getExtension('EXT_color_buffer_half_float');
  const out: Format[] = [];
  if (full && force !== 'half' && force !== 'rgba8') out.push('rgba32f');
  if (half && force !== 'rgba8') out.push('rgba16f');
  out.push('rgba8');
  return out;
}

function makeTarget(gl: WebGL2RenderingContext, n: number, format: Format) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const spec =
    format === 'rgba32f'
      ? [gl.RGBA32F, gl.RGBA, gl.FLOAT]
      : format === 'rgba16f'
        ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT]
        : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
  gl.texImage2D(gl.TEXTURE_2D, 0, spec[0], n, n, 0, spec[1], spec[2], null);
  // texelFetch ignores filtering, so no OES_texture_float_linear is needed.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, ok };
}

function makeGrid(gl: WebGL2RenderingContext, g: number) {
  const v = new Float32Array((g + 1) * (g + 1) * 2);
  for (let j = 0, k = 0; j <= g; j++) for (let i = 0; i <= g; i++, k += 2) ((v[k] = i / g), (v[k + 1] = j / g));
  const idx = new Uint32Array(g * g * 6);
  for (let j = 0, k = 0; j < g; j++)
    for (let i = 0; i < g; i++, k += 6) {
      const a = j * (g + 1) + i;
      idx.set([a, a + g + 1, a + 1, a + 1, a + g + 1, a + g + 2], k);
    }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length };
}

// ---- camera ----------------------------------------------------------------------------------

function viewProj(aspect: number, angle: number): { m: Float32Array; eye: number[] } {
  const eye = [Math.sin(angle) * 1500, 520, Math.cos(angle) * 1500];
  const tgt = [0, 70, 0];
  const f = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
  const fl = Math.hypot(...f);
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const s = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]; // f x up(0,1,0)
  const sl = Math.hypot(...s);
  s[0] /= sl; s[1] /= sl; s[2] /= sl;
  const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
  const t = (a: number[]) => -(a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]);
  const view = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, t(s), t(u), -t(f), 1];
  const fov = 1 / Math.tan((55 * Math.PI) / 360);
  const n = 10, far = 8000;
  const proj = [fov / aspect, 0, 0, 0, 0, fov, 0, 0, 0, 0, (far + n) / (n - far), -1, 0, 0, (2 * far * n) / (n - far), 0];
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += proj[k * 4 + r] * view[c * 4 + k];
      m[c * 4 + r] = sum;
    }
  return { m, eye };
}

// ---- the tier --------------------------------------------------------------------------------

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function sync(gl: WebGL2RenderingContext) {
  gl.finish();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

function bench() {
  const q = new URLSearchParams(location.search);
  const out = document.getElementById('out')!;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const log = (s: string) => (out.textContent += s + '\n');
  const report: Record<string, unknown> = { userAgent: navigator.userAgent, capability: {} };
  (window as unknown as { __result: unknown }).__result = report;

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const cap = report.capability as Record<string, unknown>;
  if (!gl || q.get('force') === 'none') {
    cap.verdict = gl ? 'forced off' : 'no WebGL2';
    log(`terrain tier: ${cap.verdict}; the CSS/ridge ground stays.`);
    document.title = 'terrain: off';
    return;
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  cap.renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  cap.vertexTextureUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
  cap.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  cap.colorBufferFloat = !!gl.getExtension('EXT_color_buffer_float');
  cap.colorBufferHalfFloat = !!gl.getExtension('EXT_color_buffer_half_float');
  cap.floatLinear = !!gl.getExtension('OES_texture_float_linear');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  cap.timerQuery = !!timer;
  if ((cap.vertexTextureUnits as number) < 1) {
    cap.verdict = 'no vertex texture fetch';
    log(`terrain tier: ${cap.verdict}; stays off.`);
    document.title = 'terrain: off';
    return;
  }

  // Phacelle is added whole; CultMath is trimmed to what the stage (and Phacelle) reaches, as the scene does.
  const stage = (pack8: boolean) => {
    const defs = `#define OCTAVES 4\n#define PACK8 ${pack8 ? 1 : 0}\n`;
    const body = HEIGHT_STAGE;
    const math = trimGlsl(cultmath, [phacelle, body]);
    cap.cultmathLines = { whole: cultmath.split('\n').length, trimmed: math.split('\n').length };
    return `${HEADER}${defs}${math}\n${phacelle}\n${body}`;
  };
  const gridDefs = (pack8: boolean) => `#define PACK8 ${pack8 ? 1 : 0}\n`;

  const want = q.get('tier');
  const tierIdx = want === null ? [0, 1, 2] : [Number(want)];
  const rows: Record<string, unknown>[] = [];
  report.tiers = rows;
  const cpuRate = Number(q.get('cpu') ?? 1);
  report.cpuThrottleRequested = cpuRate;
  const fmts = formats(gl, q.get('force'));

  let angle = 0.4;
  const drawFrame = (grid: { vao: WebGLVertexArrayObject; count: number }, prog: WebGLProgram, tex: WebGLTexture, n: number) => {
    const w = (canvas.width = canvas.clientWidth | 0), h = (canvas.height = canvas.clientHeight | 0);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.45, 0.58, 0.7, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    const { m, eye } = viewProj(w / h, angle);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uViewProj'), false, m);
    gl.uniform3f(gl.getUniformLocation(prog, 'uCamera'), eye[0], eye[1], eye[2]);
    gl.uniform1f(gl.getUniformLocation(prog, 'uSpan'), SPAN);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), n);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, 'uHeight'), 0);
    gl.bindVertexArray(grid.vao);
    gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_INT, 0);
    angle += 0.002;
  };

  let live: (() => void) | null = null;
  for (const ti of tierIdx) {
    const tier = TIERS[ti];
    const row: Record<string, unknown> = { tier: ti, grid: `${tier.grid}x${tier.grid}`, heightmap: `${tier.tex}x${tier.tex}` };
    rows.push(row);
    // First format whose framebuffer is complete.
    let target: ReturnType<typeof makeTarget> | null = null;
    let format: Format = 'rgba8';
    for (const f of fmts) {
      const t = makeTarget(gl, tier.tex, f);
      if (t.ok) { target = t; format = f; break; }
    }
    if (!target) { row.error = 'no complete render target'; continue; }
    row.format = format;
    const pack8 = format === 'rgba8';
    const eroder = program(gl, FULLSCREEN_VERT, stage(pack8));
    const drawer = program(gl, `${HEADER}${gridDefs(pack8)}${GRID_VERT}`, `${HEADER}${gridDefs(pack8)}${GRID_FRAG}`);
    const grid = makeGrid(gl, tier.grid);

    const erode = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!.fbo);
      gl.viewport(0, 0, tier.tex, tier.tex);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(eroder);
      gl.uniform1f(gl.getUniformLocation(eroder, 'uSpan'), SPAN);
      gl.bindVertexArray(gl.createVertexArray());
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    // The erosion pass: wall clock around a synchronised draw, 3 repeats after a warm-up; GPU timer if offered.
    erode(); sync(gl);
    const wall: number[] = [];
    let gpuMs: number | null = null;
    for (let r = 0; r < 3; r++) {
      let query: WebGLQuery | null = null;
      if (timer) { query = gl.createQuery()!; gl.beginQuery(timer.TIME_ELAPSED_EXT, query); }
      const t0 = performance.now();
      erode(); sync(gl);
      wall.push(performance.now() - t0);
      if (timer && query) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
          gpuMs = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
      }
    }
    row.erosionPassMs = Math.round(median(wall) * 10) / 10;
    row.erosionPassWallRepeatsMs = wall.map((w) => Math.round(w * 10) / 10);
    if (gpuMs !== null) row.erosionPassGpuTimerMs = Math.round(gpuMs * 10) / 10;

    // Sanity: height range over a centre block, so a NaN or all-zero map shows up.
    try {
      const b = 128, o = (tier.tex - b) >> 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      let lo = 1e9, hi = -1e9, bad = 0;
      if (pack8) {
        const px = new Uint8Array(b * b * 4);
        gl.readPixels(o, o, b, b, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let i = 0; i < px.length; i += 4) { const h = ((px[i] * 256 + px[i + 1]) / 65535) * HMAX; lo = Math.min(lo, h); hi = Math.max(hi, h); }
      } else {
        const px = new Float32Array(b * b * 4);
        gl.readPixels(o, o, b, b, gl.RGBA, gl.FLOAT, px);
        for (let i = 0; i < px.length; i += 4) { const h = px[i] * HMAX; if (!Number.isFinite(h)) bad++; else { lo = Math.min(lo, h); hi = Math.max(hi, h); } }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      row.centreBlockHeightM = [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10];
      if (bad) row.nonFinite = bad;
    } catch (e) { row.readbackError = String(e).slice(0, 120); }

    // Frame time: 30 draws, each synchronised, so this is the frame's cost and not the display's rate.
    for (let i = 0; i < 3; i++) { drawFrame(grid, drawer, target.tex, tier.tex); }
    sync(gl);
    const frames: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      drawFrame(grid, drawer, target.tex, tier.tex);
      sync(gl);
      frames.push(performance.now() - t0);
    }
    row.frameMsMedian = Math.round(median(frames) * 10) / 10;
    row.frameMsP95 = Math.round([...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] * 10) / 10;
    row.triangles = grid.count / 3;
    row.canvas = `${canvas.width}x${canvas.height}`;
    log(JSON.stringify(row));
    // Keep the last tier on screen, turning.
    live = () => { drawFrame(grid, drawer, target!.tex, tier.tex); requestAnimationFrame(live!); };
  }
  document.title = 'terrain: done';
  if (live && q.get('bench') !== '1') live();
}

setTimeout(bench, 50); // after load, so a slow software rasteriser cannot stall the load event
