// Standalone page: the voxel scene full-window with a readout of lookups per pixel and frame ms,
// the internal scale, and what the browser says about itself. Not shipped.
import { createVoxelScene, SCALE_LEVELS } from '../../src/app/features/scene/voxel/Voxel';
import type { FrameStats, Scene, TraceStats } from '../../src/app/features/scene/Scene';
import { LEVELS } from '../../src/app/features/scene/budget';
import { describeDevice, WHY } from './device';

let canvas = document.getElementById('c') as HTMLCanvasElement;
const out = document.getElementById('out') as HTMLPreElement;
const pull = document.getElementById('pull') as HTMLInputElement;
const scaleSel = document.getElementById('scale') as HTMLInputElement;
const scaleName = document.getElementById('scaleName') as HTMLSpanElement;
/** The slider's positions: the ladder's own, or auto. */
const SCALES = ['auto', ...SCALE_LEVELS.map((l) => String(l.scale))];
const scaleChoice = () => SCALES[+scaleSel.value];
const measure = document.getElementById('measure') as HTMLInputElement;
const dev = document.getElementById('dev') as HTMLDetailsElement;
const info = document.getElementById('info') as HTMLPreElement;
info.textContent = describeDevice();

let scene: Scene | null = null;
let trace: TraceStats | undefined;
let frames: FrameStats | undefined;
let drawMs: number | undefined;
let cadence = 0;

function start() {
  scene?.dispose();
  trace = frames = drawMs = undefined;
  cadence = 0;
  // A fresh canvas: dispose leaves the old context bound to the old one.
  const fresh = canvas.cloneNode() as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  canvas = fresh;
  out.textContent = '';
  scene = createVoxelScene({
    canvas: fresh,
    fixedPull: +pull.value,
    fixedLevel:
      scaleChoice() === 'auto' ? undefined : { ...LEVELS[0], solidScale: +scaleChoice() },
    onTraceStats: measure.checked ? (t) => (trace = t) : undefined,
    onFrameStats: (s) => {
      frames = s;
      cadence = cadence ? cadence * 0.9 + s.frameMs * 0.1 : s.frameMs;
      if (s.renderMs !== undefined) drawMs = s.renderMs;
    },
    onUnavailable: (r) => (out.textContent = `createVoxelScene returned null: ${WHY[r]}`),
    onCompileFail: (e) => (out.textContent = `createVoxelScene returned null: ${e.message}`),
  });
  dev.open = !scene;
}

setInterval(() => {
  if (!scene) return;
  const lines = [`voxel   pull ${pull.value}   scale ${scaleChoice()}`];
  if (frames) {
    lines.push(
      `frame ms ${cadence.toFixed(1)} (cadence; the cap is 33.3)   buffer ${frames.size.join('x')} at scale ${frames.scale}`
    );
  }
  if (trace) lines.push(`lookups/pixel ${trace.traceSteps.toFixed(2)}   draw ms ${drawMs?.toFixed(1)} (one frame in 8, synced)`);
  else if (measure.checked) lines.push('lookups/pixel: waiting for the first counted frame');
  out.textContent = lines.join('\n');
}, 500);

pull.addEventListener('input', start);
scaleSel.addEventListener('input', () => {
  scaleName.textContent = scaleChoice();
  start();
});
measure.addEventListener('change', start);
start();
