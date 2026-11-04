// Standalone page: the scene full-window with a readout of pass ms and trace steps per pixel, and
// a switch for the cone prepass. Not shipped.
import {
  createScene,
  Scene,
  SceneStats,
  SceneUnavailable,
  TraceStats,
} from '../../src/app/features/scene/Scene';
import { LEVELS } from '../../src/app/features/scene/budget';

let canvas = document.getElementById('c') as HTMLCanvasElement;
const out = document.getElementById('out') as HTMLPreElement;
const box = document.getElementById('prepass') as HTMLInputElement;
const pull = document.getElementById('pull') as HTMLInputElement;
const half = document.getElementById('half') as HTMLInputElement;
const dev = document.getElementById('dev') as HTMLDetailsElement;
const info = document.getElementById('info') as HTMLPreElement;
const timerless = (() => {
  const g = document.createElement('canvas').getContext('webgl2');
  return !g?.getExtension('EXT_disjoint_timer_query_webgl2');
})();

const WHY: Record<SceneUnavailable, string> = {
  'no-webgl2': 'this browser gave no WebGL2 context',
  'no-float-or-half-float-colour-buffer':
    'WebGL2 is there, but neither EXT_color_buffer_float nor EXT_color_buffer_half_float is',
};

// What the browser says about itself, read from a scratch context so it shows even when the scene
// could not start. A canvas that never got a WebGL2 context is asked for WebGL1 to name the GPU.
function describeDevice(): string {
  const c = document.createElement('canvas');
  const gl2 = c.getContext('webgl2');
  const gl = gl2 ?? (document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null);
  const lines = [`webgl2 context: ${gl2 ? 'yes' : 'NO'}`];
  if (!gl) return [...lines, 'webgl1 context: NO'].join('\n');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  lines.push(
    `renderer: ${gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)}`,
    `vendor: ${gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR)}`,
    `version: ${gl.getParameter(gl.VERSION)}`,
    `user agent: ${navigator.userAgent}`
  );
  const ext = gl.getSupportedExtensions() ?? [];
  for (const n of ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_disjoint_timer_query_webgl2'])
    lines.push(`${n}: ${ext.includes(n) ? 'yes' : 'NO'}`);
  lines.push(`extensions (${ext.length}): ${ext.join(' ')}`);
  return lines.join('\n');
}
info.textContent = describeDevice();

let scene: Scene | null = null;
let stats: SceneStats | undefined;
let trace: TraceStats | undefined;

function start() {
  scene?.dispose();
  stats = trace = undefined;
  // A fresh canvas: a context cannot change its attributes, and dispose leaves the old one bound.
  const fresh = canvas.cloneNode() as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  canvas = fresh;
  scene = createScene({
    canvas: fresh,
    unthrottled: true,
    fixedLevel: LEVELS[0],
    fixedPull: +pull.value,
    prepass: box.checked,
    halfStart: half.checked,
    onUnavailable: (r) => (out.textContent = `createScene returned null: ${WHY[r]}`),
    onCompileFail: (e) => (out.textContent = `createScene returned null: ${e.message}`),
    onStats: (s) => (stats = s),
    onTraceStats: (t) => (trace = t),
  });
  dev.open = !scene;
}

setInterval(() => {
  if (!scene) return;
  const lines = [`prepass ${box.checked ? 'on' : 'off'}   start target ${scene.startFormat}   pull ${pull.value}`];
  if (stats) {
    const ms = stats.passMs;
    const total = Object.values(ms).reduce((a, b) => a + b, 0);
    lines.push(
      `gpu ms  prepass ${ms.prepass.toFixed(2)}  terrain ${ms.terrain.toFixed(2)}  atmosphere ${ms.atmosphere.toFixed(2)}  resolve ${ms.resolve.toFixed(2)}  composite ${ms.composite.toFixed(2)}  total ${total.toFixed(2)}`,
      `solid ${stats.solidSize.join('x')}`
    );
  } else if (timerless) {
    lines.push('gpu ms: this browser has no EXT_disjoint_timer_query_webgl2');
  }
  if (trace)
    lines.push(
      `steps/pixel ${trace.stepsPerPixel.toFixed(2)}  (pass 1 ${trace.traceSteps.toFixed(2)}, prepass ${trace.prepassSteps.toFixed(1)} per tile)`
    );
  out.textContent = lines.join('\n');
}, 500);

box.addEventListener('change', start);
half.addEventListener('change', start);
pull.addEventListener('input', start);
start();
