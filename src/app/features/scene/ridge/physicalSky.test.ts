import { describe, expect, it } from 'vitest';
import { makePhysicalSky, paintSky } from './physicalSky';
import { skyBackdrop } from '../skyState';
import type { FixedSkyState } from '../skyBand';
import { windowFor } from './view';
import type { PhysicalSky } from './physicalSky';

// The Aqua method on tonemapped pixels: paint the sky the way the host canvas does and measure the WCAG luminance of every 8-bit
// texel, against the bounds the page text was checked against (`skyBackdrop`, 4.5:1). Over the weather, the day of the year, and
// viewports of different shape (the fit is made on one 16:9 grid and the paint on another).
const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luma = (d: Uint8ClampedArray, i: number): number =>
  0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);

const camera = (sky: PhysicalSky, w: number, h: number) => windowFor(sky.view, w, h).camera;
/** The camera of the viewport turned to face the sun, so the disc's colour and floor are measured wherever the sun is. */
const facingSun = (sky: PhysicalSky, w: number, h: number) => ({
  ...camera(sky, w, h),
  azimuthDeg: sky.sun.azimuth,
});

const DAYS = ['2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21'];
const WEATHER = [0, 0.3, 0.55, 0.75, 1];
const VIEWPORTS: [number, number][] = [
  [1920, 1080],
  [1024, 768],
  [2560, 1080],
  [390, 844],
];

describe.each(['day', 'dusk', 'night'] as FixedSkyState[])(
  'the %s sky stays inside its backdrop bounds',
  (state) => {
    it('over weather, season and viewport shape', () => {
      const b = skyBackdrop(state);
      let lo = 2;
      let hi = -1;
      for (const day of DAYS) {
        for (const w of WEATHER) {
          const sky = makePhysicalSky(state, new Date(`${day}T10:40:00Z`), w);
          for (const [vw, vh] of VIEWPORTS) {
            const px = paintSky(sky, vw, vh, camera(sky, vw, vh));
            for (let i = 0; i < px.w * px.h * 4; i += 4) {
              const l = luma(px.data, i);
              lo = Math.min(lo, l);
              hi = Math.max(hi, l);
            }
          }
        }
      }
      expect(lo).toBeGreaterThanOrEqual(b.darkest);
      expect(hi).toBeLessThanOrEqual(b.lightest);
    });
  }
);

describe('weather in the sky', () => {
  it('overcast is cloud: less blue and less contrast than clear air at the same sun', () => {
    const at = new Date('2026-06-21T10:40:00Z');
    const paint = (w: number) => {
      const sky = makePhysicalSky('day', at, w);
      return paintSky(sky, 640, 360, camera(sky, 640, 360));
    };
    const clear = paint(0);
    const grey = paint(0.7);
    const spread = (p: typeof clear) => {
      let lo = 2;
      let hi = -1;
      for (let i = 0; i < p.w * p.h * 4; i += 4) {
        const l = luma(p.data, i);
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
      return hi - lo;
    };
    expect(spread(grey)).toBeLessThan(spread(clear));
    const mid = (p: typeof clear) => {
      const i = (Math.floor(p.h * 0.3) * p.w + Math.floor(p.w / 2)) * 4;
      return p.data[i + 2] - p.data[i];
    };
    expect(mid(grey)).toBeLessThan(mid(clear));
  });
});

describe('the sun disc', () => {
  it('keeps the display floor the dark link was fitted to, at every hour it is drawn', () => {
    const lin = (c: number) =>
      c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
    let drawn = 0;
    for (const state of ['day', 'dusk'] as FixedSkyState[]) {
      for (let m = 0; m < 24 * 60; m += 10) {
        const sky = makePhysicalSky(state, new Date(Date.UTC(2026, 10, 11, 0, m)), 0);
        const d = paintSky(sky, 1280, 720, facingSun(sky, 1280, 720)).sunDisc;
        if (!d) continue;
        drawn += 1;
        expect(
          0.2126 * lin(d.rgb[0]) + 0.7152 * lin(d.rgb[1]) + 0.0722 * lin(d.rgb[2])
        ).toBeGreaterThanOrEqual(0.4744);
      }
    }
    expect(drawn).toBeGreaterThan(0);
  });
  const disc = (sky: PhysicalSky) => paintSky(sky, 1280, 720, facingSun(sky, 1280, 720));
  const noon = new Date('2026-12-21T11:00:00Z'); // about 18 degrees: higher suns are above the top of the window
  it('is drawn by the host, in a clear sky by day, white with the sun high', () => {
    const sky = makePhysicalSky('day', noon, 0);
    const d = disc(sky).sunDisc;
    expect(d).toBeDefined();
    expect(d!.x).toBeGreaterThan(0);
    expect(d!.x).toBeLessThan(1);
    expect(d!.y).toBeGreaterThan(0);
    expect(d!.y).toBeLessThan(camera(sky, 1280, 720).horizonAt); // above the horizon line
    expect(d!.alpha).toBe(1);
    expect(Math.min(...d!.rgb)).toBeGreaterThan(150); // a warm white at 21 degrees
  });
  it('is hidden by overcast and absent at night', () => {
    expect(disc(makePhysicalSky('day', noon, 0.7)).sunDisc).toBeUndefined();
    expect(disc(makePhysicalSky('night', noon, 0)).sunDisc).toBeUndefined();
  });
  it('is orange-tinted low in the sky', () => {
    const d = disc(makePhysicalSky('dusk', noon, 0)).sunDisc;
    expect(d).toBeDefined();
    expect(d!.rgb[0]).toBeGreaterThan(d!.rgb[2]);
  });
});
