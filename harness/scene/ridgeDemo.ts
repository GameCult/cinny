// Standalone page for the ridge scene: full window, no host app. `?tier=still|low|full` picks the
// tier, `?probe=1` shows the rAF median/p95 readout. The long tasks the page saw are on `window.longTasks`
// for a driver to read. Not shipped.
import { startBackgroundScene } from '../../src/app/features/scene';
import type { SceneTier } from '../../src/app/features/scene';

const q = new URLSearchParams(location.search);
const tier = (q.get('tier') ?? 'full') as SceneTier;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const w = window as unknown as { scene: unknown; longTasks: number[]; firstViewMs: number };
w.longTasks = [];
try {
  new PerformanceObserver((l) => l.getEntries().forEach((e) => w.longTasks.push(e.duration))).observe({
    entryTypes: ['longtask'],
  });
} catch {
  // No long-task entries in this browser.
}
const t0 = performance.now();
startBackgroundScene({ tier }, {}, {
  canvas,
} as never).then((scene) => {
  w.firstViewMs = performance.now() - t0;
  w.scene = scene;
  document.title = scene ? 'ridge: running' : 'ridge: unavailable (CSS ground)';
});
