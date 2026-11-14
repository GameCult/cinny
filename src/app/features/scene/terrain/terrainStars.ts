// The terrain scene's star layer: the ridge scene's starfield (ridge/stars.ts: placement, alpha, tint, the
// rolling twinkle schedule) on a 2D overlay canvas above the WebGL canvas, faded by the sun's elevation (starGain).
//
// The WebGL canvas is opaque, so the overlay sits on top and is cut to the sky: it is only as tall as the
// horizon line is low on screen. The camera has no roll and the eye (CAMERA.eye) is above the highest peak
// (TERRAIN.hmax), so terrain never rises above that line and a star above the horizon is never over terrain.
//
// Stars turn with the camera, as sky does: the ridge field's x becomes azimuth, repeated every PERIOD (so 400
// stars fill a sky that only ever shows 55 deg to ~120 deg of it), and y becomes elevation from the horizon
// up to ELEVATION_TOP, the top of the screen. Placement is projected with the terrain's own camera (CAMERA,
// the yaw the terrain draws at), nothing is baked, and the whole overlay is redrawn at most every FRAME_MS: a
// visible star is a few arcs on a canvas a quarter of the screen tall. The stars stop when the terrain stops:
// the layer only paints when Terrain.ts draws, and a draw with no clock (reduced motion, still tier, resize)
// paints every star at base brightness.

import { baked } from '../../../../sky/baked';
import type { SkyColours, Srgb } from '../ridge/skyColour';
import { activeAt, makeStars, SKY_STOPS, Star } from '../ridge/stars';
import { SkyData } from './terrainSky';
import { CAMERA } from './terrainWorld';

/** Azimuth the star field repeats at (radians); wider than any horizontal field of view the layer is shown at. */
export const PERIOD = (2 * Math.PI) / 3;
/** Elevation of the field's top, radians: a little above the top edge of the screen at the camera's pitch. */
export const ELEVATION_TOP = (16 * Math.PI) / 180;
/** The overlay repaints at most this often while the terrain turns (12 px/s on a phone: under half a pixel a step). */
export const FRAME_MS = 33;
/** The twinkle schedule is re-read this often; the swings are 2 to 7 s. */
const TWINKLE_MS = 50;

const hex = (h: string): Srgb =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Srgb;

/**
 * How much of the starfield shows with the sun at `elevation` degrees: all of it below -12 (where the baked
 * scattering goes dark: the planet's shadow covers every sunlit air path), none above -6 (civil twilight), a smooth
 * fade between. Not a dark/day gate: a sun at -9 shows the stars at half.
 */
export function starGain(elevation: number): number {
  const t = Math.min(1, Math.max(0, (elevation + 12) / 6));
  return 1 - t * t * (3 - 2 * t);
}

/** The ridge star module's view of the night sky it places stars against: the baked midnight gradient's zenith, middle and horizon stops. */
export function nightColours(): SkyColours {
  const g = baked.midnight.gradient;
  return {
    top: hex(g[0]),
    mid: hex(g[Math.floor(g.length / 2)]),
    horizon: hex(g[g.length - 1]),
  };
}

/** Screen height in px below which there is no sky: where the horizon plane meets the image, a straight line. */
export const horizonY = (height: number): number =>
  height * (0.5 - Math.tan(CAMERA.pitch) / Math.tan(CAMERA.fov / 2) / 2);

export interface Placed {
  x: number;
  y: number;
}

/**
 * Where a star at azimuth `da` from the camera's heading and elevation `e` (radians) lands in a `w` x `h` px
 * viewport, or null if it is behind or off the screen. The same camera as `view()` in terrainWorld.ts
 * (forward, right and up are its basis written out for a camera with yaw and pitch only).
 */
export function project(da: number, e: number, w: number, h: number): Placed | null {
  const p = CAMERA.pitch;
  const ce = Math.cos(e);
  const front = ce * Math.cos(p) * Math.cos(da) - Math.sin(e) * Math.sin(p);
  if (front <= 0.01) return null;
  const tanHalf = Math.tan(CAMERA.fov / 2);
  const nx = (ce * Math.sin(da)) / front / (tanHalf * (w / h));
  const ny = (ce * Math.sin(p) * Math.cos(da) + Math.sin(e) * Math.cos(p)) / front / tanHalf;
  if (Math.abs(nx) > 1.05) return null;
  return { x: ((nx + 1) / 2) * w, y: ((1 - ny) / 2) * h };
}

/** Elevation in radians for a ridge-field height fraction y (0 zenith side .. SKY_STOPS.horizon at the horizon). */
export const elevationOf = (y: number): number => ELEVATION_TOP * (1 - y / SKY_STOPS.horizon);

const wrap = (a: number): number => a - PERIOD * Math.round(a / PERIOD);

/** The terrain overlay draws the ridge field's stars brighter and a little larger: a phone's small, hazy sky needs it to read. */
export const BRIGHTEN = 2.4;
export const GROW = 1.3;

export interface TerrainStars {
  /** Paint for the camera `turns` into its turn (0..1). `seconds` is the clock while the terrain moves; absent: every star at base. */
  draw(turns: number, seconds?: number): void;
  /** Re-fit the overlay to the canvas's current size; the next draw repaints. */
  resize(): void;
  dispose(): void;
}

/** The layer for `canvas`'s parent, or null: the sun is too high for any star, no parent, no 2D context. */
export function createTerrainStars(canvas: HTMLCanvasElement, sky: SkyData): TerrainStars | null {
  const colours = nightColours();
  const gain = starGain(sky.elevation);
  const parent = canvas.parentElement;
  if (!parent || gain <= 0) return null;
  const el = document.createElement('canvas');
  const ctx = el.getContext?.('2d');
  if (!ctx) return null;
  el.setAttribute?.('aria-hidden', 'true');
  Object.assign(el.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
  parent.appendChild(el);

  let w = 1;
  let h = 1;
  let scale = 1;
  let field: Star[] = [];
  let lit: Array<{ star: Star; az: number; e: number }> = [];
  let gains = new Map<number, number>();
  let gainsAt = -Infinity;
  let last = -Infinity;

  const fit = () => {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    const sky = Math.max(1, Math.ceil(horizonY(h)));
    el.width = Math.max(1, Math.round(w * scale));
    el.height = Math.max(1, Math.round(sky * scale));
    el.style.width = `${w}px`;
    el.style.height = `${sky}px`;
    field = makeStars(colours, w, h);
    lit = field.map((star) => ({ star, az: star.x * PERIOD, e: elevationOf(star.y) }));
    gains = new Map();
    gainsAt = -Infinity;
  };

  const paint = (turns: number, seconds: number | undefined) => {
    ctx.clearRect(0, 0, el.width, el.height);
    if (seconds !== undefined && seconds * 1000 - gainsAt >= TWINKLE_MS) {
      gains = new Map(activeAt(field.length, seconds).map((a) => [a.star, a.gain]));
      gainsAt = seconds * 1000;
    }
    const yaw = 2 * Math.PI * turns;
    lit.forEach(({ star, az, e }, i) => {
      const da = wrap(az - yaw);
      const twinkle = seconds === undefined ? 1 : gains.get(i) ?? 1;
      ctx.globalAlpha = Math.min(1, star.alpha * twinkle * BRIGHTEN) * gain;
      ctx.fillStyle = star.fill;
      [da, da > 0 ? da - PERIOD : da + PERIOD].forEach((d) => {
        const at = project(d, e, w, h);
        if (!at || at.y < 0 || at.y > el.height / scale) return;
        ctx.beginPath();
        ctx.arc(at.x * scale, at.y * scale, star.r * GROW * scale, 0, 2 * Math.PI);
        ctx.fill();
      });
    });
    ctx.globalAlpha = 1;
  };

  fit();
  return {
    draw(turns, seconds) {
      if (seconds !== undefined && seconds * 1000 - last < FRAME_MS) return;
      last = seconds === undefined ? -Infinity : seconds * 1000;
      paint(turns, seconds);
    },
    resize() {
      fit();
      last = -Infinity;
    },
    dispose() {
      el.remove();
    },
  };
}
