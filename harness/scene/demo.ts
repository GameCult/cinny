// Standalone page: the scene full-window with a readout of pass ms and trace steps per pixel, and
// a switch for the cone prepass. Not shipped.
import { createScene, Scene, SceneStats, TraceStats } from '../../src/app/features/scene/Scene';
import { LEVELS } from '../../src/app/features/scene/budget';

let canvas = document.getElementById('c') as HTMLCanvasElement;
const out = document.getElementById('out') as HTMLPreElement;
const box = document.getElementById('prepass') as HTMLInputElement;
const pull = document.getElementById('pull') as HTMLInputElement;
const timerless = (() => {
  const g = document.createElement('canvas').getContext('webgl2');
  return !g?.getExtension('EXT_disjoint_timer_query_webgl2');
})();

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
    onStats: (s) => (stats = s),
    onTraceStats: (t) => (trace = t),
  });
  if (!scene) out.textContent = 'createScene returned null: no WebGL2 or float colour buffers';
}

setInterval(() => {
  if (!scene) return;
  const lines = [`prepass ${box.checked ? 'on' : 'off'}   pull ${pull.value}`];
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
pull.addEventListener('input', start);
start();
