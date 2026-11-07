// Standalone page for the ridge scene: full window, no host app. `?tier=still|low|full` picks the
// tier, `?probe=1` shows the rAF median/p95 readout. Not shipped.
import { startBackgroundScene } from '../../src/app/features/scene';
import type { SceneTier } from '../../src/app/features/scene';

const q = new URLSearchParams(location.search);
const tier = (q.get('tier') ?? 'full') as SceneTier;
const canvas = document.getElementById('c') as HTMLCanvasElement;
startBackgroundScene({ tier }, {}, { canvas }).then((scene) => {
  (window as unknown as { scene: unknown }).scene = scene;
  document.title = scene ? 'ridge: running' : 'ridge: unavailable (CSS ground)';
});
