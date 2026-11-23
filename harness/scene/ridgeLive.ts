// One live ridge scene (tier 'full': the sky plate and the cards on the compositor) filling the window, for a driver to turn and screenshot. Not shipped.
// `?h=214`  the heading the scene starts at; `?sun=232:22`  the sun's compass azimuth and elevation (degrees); `?sky=night`  the stars of now (sun below the horizon); `?lines=1` the constellation lines.
// `?speed=6`  degrees a second the view turns (rotation mode 'both'); 0 holds it. The page offers `window.live`: `hold(h)` turns the view by hand, `pose()` is the heading owner's pose now,
// `plate()` the sky plate's element and `left()` its left edge and width on the page.
import { parseManifest } from '../../src/app/features/scene/ridge/manifest';
import { makePhysicalSky } from '../../src/app/features/scene/ridge/physicalSky';
import { createBackdrop } from '../../src/app/features/scene/ridge/Backdrop';
import { createRidgeScene } from '../../src/app/features/scene/ridge/Ridge';
import { anchor, hold, poseAt } from '../../src/app/features/scene/ridge/heading';
import { setCamera } from '../../src/app/features/scene/cameraState';
import { HFOV_MAX_DEG, windowFor } from '../../src/app/features/scene/ridge/view';
import { paintSky } from '../../src/app/features/scene/ridge/physicalSky';
import { nightBodies } from '../../src/app/features/scene/ridge/nightBodies';
import { plateCamera, plateSize } from '../../src/app/features/scene/ridge/skyTurn';

const q = new URLSearchParams(location.search);
/** The main-thread tasks over 50 ms the page saw, ms: `window.longTasks`. */
const longTasks: number[] = [];
(window as unknown as { longTasks: number[] }).longTasks = longTasks;
try {
  new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration))).observe({ entryTypes: ['longtask'] });
} catch {
  // No long-task entries in this browser.
}

async function main() {
  const index = await (await fetch('/public/ridge/index.json')).json();
  const dir = `/public/ridge/${index.places[q.get('place') ?? index.default]}/`;
  const manifest = parseManifest(await (await fetch(`${dir}manifest.json`)).json(), dir);
  const { view } = manifest;
  const [az, el] = (q.get('sun') ?? '232:22').split(':').map(Number);
  const time = new Date();
  const sun = q.get('sky') === 'night' ? { azimuth: 0, elevation: -30, time } : { azimuth: az, elevation: el, time };
  const physical = makePhysicalSky(sun, 0, view);
  const h0 = Number(q.get('h') ?? view.lookAzDeg);
  anchor(view.place.id, h0, performance.now());
  setCamera({ mode: 'both', speedDegPerS: Number(q.get('speed') ?? 0), offsetM: 200 });
  const backdrop = createBackdrop(manifest, physical);
  await backdrop.ensure({ fromDeg: h0 - HFOV_MAX_DEG, toDeg: h0 + HFOV_MAX_DEG });
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const scene = createRidgeScene({ canvas, tier: 'full', sky: { ...physical.stops, physical }, backdrop, lines: q.get('lines') === '1' });
  const host = document.getElementById('host') as HTMLElement;
  // The plate is the host's div whose first child is a canvas (the rig's first child is a div, the rain's has none).
  const plate = () => [...host.children].find((c) => c.tagName === 'DIV' && c.firstElementChild?.tagName === 'CANVAS');
  (window as unknown as { live: unknown }).live = {
    scene,
    hold: (h: number) => hold(h, performance.now()),
    pose: () => poseAt(performance.now()),
    plate,
    /** Mean ms of the main-thread part of painting one plate here (the dome, its pixels and the bodies, not the canvas upscale), over `n` runs. */
    plateCost: (n = 10) => {
      const w = innerWidth;
      const h = innerHeight;
      const win = windowFor(view, w, h);
      const { cssW } = plateSize(win, w, h, devicePixelRatio >= 2 ? 2 : 1);
      const t0 = performance.now();
      for (let i = 0; i < n; i += 1) nightBodies(physical, paintSky(physical, cssW, h, plateCamera(win, 214 + i)), true);
      return (performance.now() - t0) / n;
    },
    left: () => {
      const r = plate()?.getBoundingClientRect();
      return r && { left: r.left, width: r.width };
    },
  };
  document.title = 'ridge live: done';
}

main().catch((e) => {
  console.error(e);
  document.title = `ridge live: failed ${e}`;
});
