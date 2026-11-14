// The ridge scene's sky: the View's place's sun on the real clock, the atmosphere baked from it, a camera, and the display that makes it
// pixels. `makePhysicalSky` does the one expensive thing (the LUT bake, tens of ms) and fits the display from a fixed 16:9
// grid, so resizing the window repaints the same sky. `paintSky` is per-texel lookups only.
import type { FixedSkyState } from '../skyBand';
import { bakeAtmosphere } from './earthAtmosphere';
import type { Atmosphere } from './earthAtmosphere';
import { domeSize, renderDome, SUN_RADIUS, sunOnScreen } from './skyDome';
import type { Dome } from './skyDome';
import type { Srgb } from './skyColour';
import { display8, fitDisplay, holdBudget, MARGIN } from './toneMap';
import type { Display, Fit } from './toneMap';
import { sunForState } from './sunAt';
import type { SunSample } from './sunAt';
import { windowFor } from './view';
import type { Camera, View } from './view';
import { weatherOf } from './weather';
import type { Weather } from './weather';

export interface PhysicalSky {
  state: FixedSkyState;
  /** Where the observer stands and where the planes look: the camera of any viewport is `windowFor(view, w, h).camera`. */
  view: View;
  sun: SunSample;
  weather: Weather;
  atm: Atmosphere;
  /** The display fitted to this sky's budget. */
  fit: Fit;
  /** The sky at the top, the middle and the horizon of the image (mean of each row), for the layers' haze and the stars' cover. */
  stops: { top: Srgb; mid: Srgb; horizon: Srgb };
  /** How long the bake took, ms. */
  bakeMs: number;
}

const CANON = { w: 64, h: 36 };

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function rowMean(dome: Dome, display: Display, row: number): Srgb {
  const out = [0, 0, 0];
  const acc = [0, 0, 0];
  const j = Math.min(dome.h - 1, Math.max(0, row));
  for (let i = 0; i < dome.w; i += 1) {
    const o = (j * dome.w + i) * 3;
    display8(dome.hdr[o], dome.hdr[o + 1], dome.hdr[o + 2], display, out);
    acc[0] += out[0];
    acc[1] += out[1];
    acc[2] += out[2];
  }
  return [Math.round(acc[0] / dome.w), Math.round(acc[1] / dome.w), Math.round(acc[2] / dome.w)];
}

export function makePhysicalSky(
  state: FixedSkyState,
  now: Date,
  weatherValue: number,
  view: View
): PhysicalSky {
  const t0 = clock();
  const sun = sunForState(view.place, state, now);
  const weather = weatherOf(weatherValue);
  const atm = bakeAtmosphere({
    sunElevationDeg: sun.elevation,
    mieScale: weather.mieScale,
    observerKm: view.place.altitudeKm,
  });
  // A 16:9 viewport: the camera's fov and horizon fraction do not depend on its size, only on its shape.
  const { camera } = windowFor(view, CANON.w, CANON.h);
  const dome = renderDome(atm, sun, camera, CANON.w, CANON.h, weather.cover);
  const fit = fitDisplay(state, dome.hdr, dome.meanLuma);
  const at = (f: number) => rowMean(dome, fit.display, Math.round(f * CANON.h));
  return {
    state,
    view,
    sun,
    weather,
    atm,
    fit,
    stops: { top: at(0.02), mid: at(0.5), horizon: at(camera.horizonAt) },
    bakeMs: clock() - t0,
  };
}

export interface SkyPixels {
  w: number;
  h: number;
  /** RGBA, 8 bit. */
  data: Uint8ClampedArray;
  dome: Dome;
  camera: Camera;
  /** The sun's disc for the host to draw on the upscaled canvas (it is smaller than a texel): place as fractions of the image, colour, radius in fractions of the height, opacity after the cloud. */
  sunDisc?: { x: number; y: number; rgb: Srgb; radius: number; alpha: number };
}

/** The sky for a viewport seen through `camera` (`windowFor(p.view, cssW, cssH).camera`), as a small RGBA grid the host canvas upscales smoothly. */
export function paintSky(p: PhysicalSky, cssW: number, cssH: number, camera: Camera): SkyPixels {
  const { w, h } = domeSize(cssW, cssH);
  const dome = renderDome(p.atm, p.sun, camera, w, h, p.weather.cover);
  const data = new Uint8ClampedArray(w * h * 4);
  const out = [0, 0, 0];
  const display = holdBudget(p.state, dome.hdr, p.fit.display);
  for (let i = 0; i < w * h; i += 1) {
    display8(dome.hdr[i * 3], dome.hdr[i * 3 + 1], dome.hdr[i * 3 + 2], display, out);
    data[i * 4] = out[0];
    data[i * 4 + 1] = out[1];
    data[i * 4 + 2] = out[2];
    data[i * 4 + 3] = 255;
  }
  return { w, h, data, dome, camera, sunDisc: sunDisc(p, camera) };
}

/** The luma the disc must keep: the day/dusk floor of toneMap's budget. */
const DISC_FLOOR = 0.4744 + MARGIN;
const smooth01 = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The sun's disc: always brighter than the display's white, so what is left of it is its colour, the air's transmittance to the sun
 * normalised to its strongest channel (white high up, orange near the horizon). Thick cloud hides it.
 */
function sunDisc(p: PhysicalSky, camera: Camera): SkyPixels['sunDisc'] {
  const at = sunOnScreen(p.sun, camera);
  const alpha = 1 - smooth01(0.1, 0.6, p.weather.cover);
  if (!at || alpha <= 0) return undefined;
  const trans = [0, 0, 0];
  p.atm.transmittanceToSpace(Math.max(Math.sin((p.sun.elevation * Math.PI) / 180), 0), trans);
  const top = Math.max(...trans, 1e-9);
  const rgb = trans.map((t) => Math.round(255 * (t / top) ** 0.6));
  // The disc sits on the sky, so it keeps the display floor the dark link was fitted to: mix toward white until it does.
  const lin = (c: number): number =>
    c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
  const luma = (c: number[]): number =>
    0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  for (let m = 0; luma(rgb) < DISC_FLOOR && m < 40; m += 1)
    for (let i = 0; i < 3; i += 1) rgb[i] = Math.round(rgb[i] + (255 - rgb[i]) * 0.1);
  return {
    ...at,
    rgb: rgb as unknown as Srgb,
    radius: (SUN_RADIUS * 180) / Math.PI / camera.vfovDeg,
    alpha,
  };
}
