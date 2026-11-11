import { describe, expect, it } from 'vitest';
import { BakeParams, bakeSlice, faceLight, layerPaint, sunDirection } from './ridgeBake';
import { SKY_BAND } from '../skyBand';
import { ridgeSkyFor } from '../skyForState';
import { LACUNARITY, LAYERS, profile } from './ridgeWorld';
import { skyColours, SkyColours } from './skyColour';

const SKY: SkyColours = { ...skyColours(), sunAzimuth: 0.3 }; // sun toward +x
const PERIOD = 400;
const VIEW_H = 800;
const BAND = 480;

const params = (
  li: number,
  px0: number,
  cols: number,
  over: Partial<BakeParams> = {}
): BakeParams => ({
  spec: LAYERS[li],
  sky: SKY,
  period: PERIOD,
  scale: 1,
  viewH: VIEW_H,
  rows: BAND,
  bandH: BAND,
  px0,
  cols,
  ...over,
});

function bake(p: BakeParams, slices: number[] = [p.cols]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(p.cols * p.rows * 4);
  const paint = layerPaint(p.spec, p.sky);
  let c = 0;
  for (const n of slices) {
    bakeSlice(out, p, paint, c, Math.min(p.cols, c + n));
    c += n;
  }
  return out;
}

const lum = (d: Uint8ClampedArray, cols: number, x: number, y: number) => {
  const o = (y * cols + x) * 4;
  return 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
};
/** First row of column x whose alpha is full. */
const solidRow = (d: Uint8ClampedArray, cols: number, x: number) => {
  let y = 0;
  while (y < BAND && d[(y * cols + x) * 4 + 3] < 255) y += 1;
  return y;
};

describe('the field is a function of world-x', () => {
  it('is deterministic, and defined and bounded at any world-x', () => {
    for (const spec of LAYERS) {
      for (const t of [-40.3, 0, 0.5, 17.77, 5000.123]) {
        expect(profile(spec, t)).toBe(profile(spec, t));
        expect(profile(spec, t)).toBeGreaterThanOrEqual(0);
        expect(profile(spec, t)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has no repeat at the old period (1 viewport) or its multiples: the profile differs from itself shifted', () => {
    for (const spec of LAYERS) {
      for (const lag of [1, 2, 3, 0.5]) {
        let diff = 0;
        for (let i = 0; i < 400; i += 1)
          diff += Math.abs(profile(spec, i / 100) - profile(spec, i / 100 + lag));
        expect(diff / 400).toBeGreaterThan(0.04);
      }
    }
  });

  it('the same world column bakes to the same pixels whichever chunk or slice paints it', () => {
    for (const li of [0, 3]) {
      const whole = bake(params(li, 1000, 200));
      const sliced = bake(params(li, 1000, 200), [37, 64, 1000]);
      expect(Array.from(sliced)).toEqual(Array.from(whole));
      // A chunk starting 120 columns later sees the same pixels for the columns it shares.
      const shifted = bake(params(li, 1120, 80));
      for (const x of [0, 17, 79]) {
        for (const y of [0, 100, 300, BAND - 1]) {
          const a = (y * 200 + 120 + x) * 4;
          const b = (y * 80 + x) * 4;
          expect(Array.from(shifted.slice(b, b + 4))).toEqual(Array.from(whole.slice(a, a + 4)));
        }
      }
    }
  });

  it('is continuous across a chunk seam: the crest steps no more at the seam than elsewhere', () => {
    const chunk = Math.round(PERIOD * 1.2);
    for (const li of [0, 1, 2, 3]) {
      const p = params(li, chunk - 40, 80);
      const d = bake(p);
      let worst = 0;
      for (let x = 1; x < 80; x += 1)
        worst = Math.max(worst, Math.abs(solidRow(d, 80, x) - solidRow(d, 80, x - 1)));
      const seam = Math.abs(solidRow(d, 80, 40) - solidRow(d, 80, 39));
      expect(seam).toBeLessThanOrEqual(Math.max(worst, 1));
      // and the seam columns equal a chunk baked from the other side
      const other = bake(params(li, chunk - 40, 80, { cols: 80 }));
      expect(Array.from(other)).toEqual(Array.from(d));
    }
  });
});

describe('shading from the slope normal', () => {
  const sun = sunDirection(SKY);

  it('the sun is toward +x for azimuth 0.3', () => {
    expect(sun[0]).toBeGreaterThan(0.5);
  });

  it('a face looking at the sun is lit more than one looking away', () => {
    // slope < 0: the crest falls toward +x, so the face looks at +x, at the sun.
    for (const s of [0.2, 0.6, 1.5]) expect(faceLight(-s, sun)).toBeGreaterThan(faceLight(s, sun));
    expect(faceLight(1.5, sun)).toBeLessThan(0.2);
    expect(faceLight(-1.5, sun)).toBeGreaterThan(0.6);
  });

  it('in the baked pixels the lit side is brighter than the shadow side', () => {
    for (const li of [0, 1, 2]) {
      const cols = 900;
      const p = params(li, 0, cols);
      const d = bake(p);
      const slope = (x: number) => (solidRow(d, cols, x - 1) - solidRow(d, cols, x + 1)) / 2; // rows up per column
      const litX: number[] = [];
      const shadeX: number[] = [];
      for (let x = 2; x < cols - 2; x += 1) {
        if (slope(x) < -0.8) litX.push(x);
        if (slope(x) > 0.8) shadeX.push(x);
      }
      expect(litX.length).toBeGreaterThan(5);
      expect(shadeX.length).toBeGreaterThan(5);
      const mean = (xs: number[]) =>
        xs.reduce((a, x) => a + lum(d, cols, x, solidRow(d, cols, x) + 12), 0) / xs.length;
      expect(mean(litX)).toBeGreaterThan(mean(shadeX));
    }
  });

  it('a lit crest rim: the crest pixels are brighter than the face a little below, on both sides', () => {
    for (const li of [0, 1, 2, 3]) {
      const cols = 600;
      const d = bake(params(li, 300, cols));
      let rimmed = 0;
      let n = 0;
      for (let x = 3; x < cols - 3; x += 1) {
        const y = solidRow(d, cols, x);
        if (y + 40 >= BAND) continue;
        n += 1;
        if (lum(d, cols, x, y + 1) > lum(d, cols, x, y + 30)) rimmed += 1;
      }
      expect(n).toBeGreaterThan(100);
      expect(rimmed / n).toBeGreaterThan(0.8);
    }
  });

  it('the foot of the face is clearly darker than its top, on every layer: volume from the depth below the crest', () => {
    // Without the depth shading the bottom row is 0.93 to 0.98 of the luminance 12 rows under the crest; with it, 0.73 to 0.82.
    for (const li of [0, 1, 2, 3]) {
      const cols = 900;
      const d = bake(params(li, 0, cols, { spec: { ...LAYERS[li], mist: 0, gully: 0 } }));
      let ratio = 0;
      let n = 0;
      for (let x = 0; x < cols; x += 1) {
        const y = solidRow(d, cols, x);
        if (y + 90 >= BAND) continue;
        n += 1;
        ratio += lum(d, cols, x, BAND - 1) / Math.max(1, lum(d, cols, x, y + 12));
      }
      expect(n).toBeGreaterThan(30);
      expect(ratio / n).toBeLessThan(0.88);
    }
  });

  it('the valley mist still pulls the foot toward the haze colour', () => {
    const cols = 300;
    const p = params(0, 0, cols);
    const misty = bake(p);
    const clear = bake(params(0, 0, cols, { spec: { ...LAYERS[0], mist: 0 } }));
    const haze = layerPaint(p.spec, p.sky).haze;
    const dist = (d: Uint8ClampedArray, x: number, y: number) => {
      const o = (y * cols + x) * 4;
      return Math.hypot(d[o] - haze[0], d[o + 1] - haze[1], d[o + 2] - haze[2]);
    };
    let nearer = 0;
    let n = 0;
    for (let x = 0; x < cols; x += 1) {
      const y = solidRow(misty, cols, x);
      if (y + 200 >= BAND) continue;
      n += 1;
      if (dist(misty, x, y + 200) < dist(clear, x, y + 200)) nearer += 1;
    }
    expect(n).toBeGreaterThan(50);
    expect(nearer / n).toBeGreaterThan(0.9);
  });

  it('erosion streaks run down the face: brightness varies across columns at one depth, and not without them', () => {
    const cols = 500;
    const spread = (gully: number) => {
      const d = bake(params(2, 0, cols, { spec: { ...LAYERS[2], gully } }));
      // The same depth below the crest in every column, in the lit-independent part (gullies darken, lit is column-wise).
      const v: number[] = [];
      for (let x = 0; x < cols; x += 1) {
        const y = solidRow(d, cols, x);
        if (y + 90 < BAND) v.push(lum(d, cols, x, y + 80) / Math.max(1, lum(d, cols, x, y + 8)));
      }
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
    };
    expect(spread(LAYERS[2].gully)).toBeGreaterThan(spread(0) * 1.2);
  });
});

describe('bake cost', () => {
  it('is recorded, not asserted: one chunk of every layer at 1280 x 720', () => {
    const period = 1280;
    const rows = Math.round(720 * 0.6);
    const ms = LAYERS.map((spec) => {
      const p: BakeParams = {
        spec,
        sky: SKY,
        period,
        scale: 1,
        viewH: 720,
        rows,
        bandH: rows,
        px0: 0,
        cols: Math.round(period * 1.2),
      };
      const t0 = performance.now();
      bake(p);
      return performance.now() - t0;
    });
    expect(ms.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    console.info(
      `ridge bake ms per layer (node, 1 chunk, 1280x720): ${ms.map((v) => v.toFixed(1)).join(' ')}`
    );
  });
});

describe('the ridged multifractal core, each rule on its own', () => {
  const one = { ...LAYERS[0], octaves: 1, warp: 0, crag: 1 };

  it('folds each octave at its crest: a creased, sharp ridge line, not a smooth swell', () => {
    // Largest second difference over a fine scan. A smooth curve of this size stays in the hundreds;
    // a fold leaves a crease where the noise crosses its midpoint.
    const h = 1e-3;
    let worst = 0;
    for (let i = 1; i < 20000; i += 1) {
      const t = i * h;
      worst = Math.max(
        worst,
        Math.abs(profile(one, t + h) - 2 * profile(one, t) + profile(one, t - h)) / (h * h)
      );
    }
    expect(worst).toBeGreaterThan(2000);
  });

  it('domain-warps: the same layer without its warp is a measurably different line', () => {
    const spec = LAYERS[1];
    let diff = 0;
    for (let i = 0; i < 2000; i += 1)
      diff += Math.abs(profile(spec, i / 100) - profile({ ...spec, warp: 0 }, i / 100));
    expect(diff / 2000).toBeGreaterThan(0.02);
  });

  it('weights each octave by the previous one: where the first octave is low, the later ones add almost nothing', () => {
    const lo = { ...LAYERS[1], octaves: 1, warp: 0 };
    const hi = { ...LAYERS[1], octaves: 5, warp: 0 };
    let valley = 0;
    let nv = 0;
    let peak = 0;
    let np = 0;
    for (let i = 0; i < 10000; i += 1) {
      const a = profile(lo, i / 500);
      const d = Math.abs(profile(hi, i / 500) - a);
      if (a < 0.12) {
        valley += d;
        nv += 1;
      } else if (a > 0.35) {
        peak += d;
        np += 1;
      }
    }
    expect(nv).toBeGreaterThan(200);
    expect(np).toBeGreaterThan(200);
    expect(valley / nv).toBeLessThan(0.25 * (peak / np));
  });

  it('octave lattices do not line up: the lacunarity is not a power of two', () => {
    expect(Number.isInteger(Math.log2(LACUNARITY))).toBe(false);
    expect(Number.isInteger(LACUNARITY)).toBe(false);
  });

  it('distance flattens relief: contrast falls from the nearest layer to the farthest', () => {
    const c = LAYERS.map((spec) => layerPaint(spec, SKY).contrast);
    expect(c[LAYERS.length - 1]).toBe(1);
    for (let i = 1; i < c.length; i += 1) expect(c[i]).toBeGreaterThan(c[i - 1]);
    // and it shows in the pixels: the lit/shadow difference is smaller on the farthest layer than the nearest
    const gap = (li: number) => {
      const cols = 700;
      const d = bake(params(li, 0, cols));
      const slope = (x: number) => (solidRow(d, cols, x - 1) - solidRow(d, cols, x + 1)) / 2;
      const avg = (pick: (s: number) => boolean) => {
        const xs = Array.from({ length: cols - 4 }, (_, k) => k + 2).filter((x) => pick(slope(x)));
        return (
          xs.reduce((a, x) => a + lum(d, cols, x, solidRow(d, cols, x) + 12), 0) /
          Math.max(1, xs.length)
        );
      };
      return (
        Math.abs(avg((s) => s < -0.8) - avg((s) => s > 0.8)) /
        Math.max(
          1,
          avg(() => true)
        )
      );
    };
    expect(gap(0)).toBeLessThan(gap(3));
  });
});

describe('the state band: the theme ink clears 4.5:1 on a ridge as on bare sky', () => {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luma = (d: Uint8ClampedArray, o: number) =>
    0.2126 * linear(d[o]) + 0.7152 * linear(d[o + 1]) + 0.0722 * linear(d[o + 2]);
  /** Lowest and highest luminance over the solid pixels of every layer. */
  const range = (band: typeof SKY_BAND[keyof typeof SKY_BAND] | undefined) => {
    let lo = 1;
    let hi = 0;
    for (const li of [0, 1, 2, 3]) {
      const p = params(li, 0, 700, { sky: { ...SKY, band } });
      const d = bake(p);
      for (let o = 0; o < d.length; o += 4) {
        if (d[o + 3] < 255) continue;
        const l = luma(d, o);
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
    }
    return { lo, hi };
  };

  it("day and dusk: no ridge pixel is darker than the text floor (Day's), on every layer", () => {
    for (const band of [SKY_BAND.day, SKY_BAND.dusk]) {
      expect(range(band).lo).toBeGreaterThanOrEqual(SKY_BAND.day.floor);
    }
  });

  it('night: no ridge pixel is lighter than the ceiling', () => {
    expect(range(SKY_BAND.night).hi).toBeLessThanOrEqual(SKY_BAND.night.ceiling);
  });

  it('is the identity with no band, so nothing else changes', () => {
    expect(layerPaint(LAYERS[2], SKY).shift).toBeNull();
    expect(range(undefined).lo).toBeLessThan(SKY_BAND.day.floor);
  });

  it('keeps the shading: the foot is still darker than the top inside the band', () => {
    // Inside the band the face's range is compressed, not removed: dusk, no mist or gullies, bottom row over 12 rows under the crest.
    const sky = { ...SKY, band: SKY_BAND.dusk };
    for (const li of [0, 1, 2, 3]) {
      const cols = 900;
      const d = bake(params(li, 0, cols, { sky, spec: { ...LAYERS[li], mist: 0, gully: 0 } }));
      let ratio = 0;
      let n = 0;
      for (let x = 0; x < cols; x += 1) {
        const y = solidRow(d, cols, x);
        if (y + 90 >= BAND) continue;
        n += 1;
        ratio += luma(d, ((BAND - 1) * cols + x) * 4) / luma(d, ((y + 12) * cols + x) * 4);
      }
      expect(n).toBeGreaterThan(30);
      // Measured 0.84, 0.85, 0.91, 0.97 far to near: the nearest ground is near black, so its range is small in absolute terms.
      expect(ratio / n).toBeLessThan(li < 3 ? 0.95 : 1);
    }
  });

  it('the real states, over a sweep of the sun: no pixel overflows the encoding (an overflow reads as a stray black or yellow channel)', () => {
    for (const state of ['day', 'dusk', 'night'] as const) {
      for (const sunAzimuth of [0, 0.1, 0.25, 0.3, 0.5, 0.75, 0.9]) {
        const sky = { ...ridgeSkyFor(state), sunAzimuth };
        for (const li of [0, 1, 2, 3]) {
          const d = bake(params(li, 1000, 400, { sky }));
          let stray = 0;
          for (let o = 0; o < d.length; o += 4) {
            if (d[o + 3] < 255) continue;
            // A channel far below both others is the signature of a lookup that read past its table.
            const lo = Math.min(d[o], d[o + 1], d[o + 2]);
            const mid = d[o] + d[o + 1] + d[o + 2] - lo - Math.max(d[o], d[o + 1], d[o + 2]);
            if (mid - lo > 120) stray += 1;
          }
          expect(stray).toBe(0);
        }
      }
    }
  });
});
