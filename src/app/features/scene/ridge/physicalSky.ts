// The ridge scene's sky: Vienna's sun on the real clock, the atmosphere baked from it, a camera, and the display that makes it
// pixels. `makePhysicalSky` does the one expensive thing (the LUT bake, tens of ms) and fits the display from a fixed 16:9
// grid, so resizing the window repaints the same sky. `paintSky` is per-texel lookups only.
import type { FixedSkyState } from '../skyBand';
import { bakeAtmosphere } from './earthAtmosphere';
import type { Atmosphere } from './earthAtmosphere';
import { domeSize, HORIZON_AT, renderDome, viewFor } from './skyDome';
import type { Dome, DomeView } from './skyDome';
import type { Srgb } from './skyColour';
import { display8, fitDisplay } from './toneMap';
import type { Display, Fit } from './toneMap';
import { sunForState, VIENNA } from './vienna';
import type { SunSample } from './vienna';
import { weatherOf } from './weather';
import type { Weather } from './weather';

export interface PhysicalSky {
  state: FixedSkyState;
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

const CANON = { w: 64, h: 36, aspect: 16 / 9 };

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

export function makePhysicalSky(state: FixedSkyState, now: Date, weatherValue: number): PhysicalSky {
  const t0 = clock();
  const sun = sunForState(state, now);
  const weather = weatherOf(weatherValue);
  const atm = bakeAtmosphere({
    sunElevationDeg: sun.elevation,
    mieScale: weather.mieScale,
    observerKm: VIENNA.altitudeKm,
  });
  const dome = renderDome(atm, sun, viewFor(sun, CANON.aspect), CANON.w, CANON.h);
  const fit = fitDisplay(state, dome.hdr, dome.meanLuma);
  const at = (f: number) => rowMean(dome, fit.display, Math.round(f * CANON.h));
  return {
    state,
    sun,
    weather,
    atm,
    fit,
    stops: { top: at(0.02), mid: at(0.5), horizon: at(HORIZON_AT) },
    bakeMs: clock() - t0,
  };
}

export interface SkyPixels {
  w: number;
  h: number;
  /** RGBA, 8 bit. */
  data: Uint8ClampedArray;
  dome: Dome;
  view: DomeView;
}

/** The sky for a viewport, as a small RGBA grid the host canvas upscales smoothly. */
export function paintSky(p: PhysicalSky, cssW: number, cssH: number): SkyPixels {
  const { w, h } = domeSize(cssW, cssH);
  const view = viewFor(p.sun, cssW / cssH);
  const dome = renderDome(p.atm, p.sun, view, w, h);
  const data = new Uint8ClampedArray(w * h * 4);
  const out = [0, 0, 0];
  for (let i = 0; i < w * h; i += 1) {
    display8(dome.hdr[i * 3], dome.hdr[i * 3 + 1], dome.hdr[i * 3 + 2], p.fit.display, out);
    data[i * 4] = out[0];
    data[i * 4 + 1] = out[1];
    data[i * 4 + 2] = out[2];
    data[i * 4 + 3] = 255;
  }
  return { w, h, data, dome, view };
}
