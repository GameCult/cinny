// Standalone page for the ridge and mesh scenes: full window, no host app. `?tier=still|low|full` picks the
// tier, `?style=mesh` the heightfield-with-haze scene (default: the baked ridges), `?rowhaze=1` adds the
// screen-row haze gradient to the baked ridges, `?probe=1` shows the rAF median/p95 readout. Not shipped.
import { startBackgroundScene } from '../../src/app/features/scene';
import type { SceneStyle, SceneTier } from '../../src/app/features/scene';
import { createRidgeScene } from '../../src/app/features/scene/ridge/Ridge';

const q = new URLSearchParams(location.search);
const tier = (q.get('tier') ?? 'full') as SceneTier;
const style = (q.get('style') ?? 'ridge') as SceneStyle;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const started =
  q.get('rowhaze') === '1'
    ? Promise.resolve(createRidgeScene({ canvas, tier, rowHaze: true }))
    : startBackgroundScene({ tier, style }, {}, { canvas });
started.then((scene) => {
  (window as unknown as { scene: unknown }).scene = scene;
  document.title = scene ? `${style}: running` : `${style}: unavailable (CSS ground)`;
});
