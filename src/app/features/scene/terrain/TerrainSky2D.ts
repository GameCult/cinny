import type { Scene } from '../Scene';
import type { TerrainOptions } from './Terrain';
import { chooseSky, skyColour, START_TURNS, Vec3 } from './terrainSky';
import { createTerrainStars } from './terrainStars';
import { showTierLabel } from './tierLabel';
import { CAMERA, view } from './terrainWorld';

/** The sky is smooth, so it is painted this many px wide and stretched by the canvas's CSS size. */
export const SKY_WIDTH = 96;

/** The sky of the terrain scene without WebGL2: the camera's first frame of `skyColour`, once, on a 2D canvas, with the star layer on top. */
export type TerrainSkyOptions = Pick<TerrainOptions, 'canvas' | 'tier' | 'sky' | 'sun'>;

/**
 * Same contract as `createTerrainScene`. Paints the terrain scene's sky (the CPU twin of its sky shader, from the
 * same baked tables and the same `?sun=` `?az=` `?sky=` choice) for the camera at its start, still: nothing moves, so
 * a device that cannot run WebGL2 pays one paint and one resize repaint. Below the horizon there is no terrain, so
 * the image continues with the horizon's colour. Null for "keep the CSS ground": tier off, or the canvas already
 * holds a WebGL context and gives no 2D one.
 */
export function createTerrainSkyScene(opts: TerrainSkyOptions): Scene | null {
  if ((opts.tier ?? 'full') === 'off') return null;
  const { canvas } = opts;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const sky = chooseSky(opts);
  const stars = createTerrainStars(canvas, sky);
  const heading = START_TURNS;
  const tanHalf = Math.tan(CAMERA.fov / 2);
  let disposed = false;
  let resizeTimer = 0;

  const paint = () => {
    const w = SKY_WIDTH;
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    const h = Math.max(1, Math.round((w * ch) / cw));
    canvas.width = w;
    canvas.height = h;
    const v = view(cw / ch, heading);
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      const ny = 1 - ((y + 0.5) / h) * 2;
      for (let x = 0; x < w; x += 1) {
        const nx = ((x + 0.5) / w) * 2 - 1;
        const d = [0, 1, 2].map(
          (i) => v.forward[i] + nx * tanHalf * (cw / ch) * v.right[i] + ny * tanHalf * v.up[i]
        );
        const len = Math.hypot(d[0], d[1], d[2]);
        const c: Vec3 = skyColour(sky, [d[0] / len, d[1] / len, d[2] / len]);
        const at = (y * w + x) * 4;
        for (let i = 0; i < 3; i += 1) {
          image.data[at + i] = Math.round(255 * Math.min(1, Math.max(0, c[i])) ** (1 / 2.2));
        }
        image.data[at + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    stars?.draw(heading);
  };

  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      stars?.resize();
      paint();
    }, 250);
  };
  window.addEventListener('resize', onResize);
  paint();
  const removeLabel = showTierLabel(canvas, 'sky-only');

  return {
    login() {
      // Nothing moves, so there is no pull-back to start.
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      removeLabel?.();
      stars?.dispose();
    },
  };
}
