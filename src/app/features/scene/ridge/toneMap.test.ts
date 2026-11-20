import { describe, expect, it } from 'vitest';
import { FALLBACK_VIEW } from './view';
import { makePhysicalSky } from './physicalSky';
import { sunOfBand } from './skyTestkit';
import { renderDome } from './skyDome';
import { windowFor } from './view';
import { applyCurve, BLACK_LIFT, BUDGET, NIGHT_CEILING, NIGHT_LIFT, SCOTOPIC, displayLumaOf, fitDisplay, makeCurve, scotopic, scotopicWeight } from './toneMap';
import { sunAt } from './sunAt';
import type { FixedSkyState } from './skyMoment';

const sweep = (c: ReturnType<typeof makeCurve>) =>
  Array.from({ length: 401 }, (_, i) => applyCurve(c, i / 400));

describe('the tone curve', () => {
  it('is monotone, starts at the black lift and ends at the top knot, for a spread of knots', () => {
    const cases: [number[], number[]][] = [
      [[0, 0.01, 0.2, 0.7, 1], [BLACK_LIFT, 0.12, 0.5, 0.9, 1]],
      [[0, 0.0005, 0.003, 0.05, 1], [BLACK_LIFT, 0.0225, 0.04, 0.043, 0.043]],
      [[0, 0.3, 0.31, 0.32, 1], [BLACK_LIFT, 0.2, 0.5, 0.8, 1]],
    ];
    for (const [x, y] of cases) {
      const c = makeCurve(x, y);
      const v = sweep(c);
      expect(v[0]).toBeCloseTo(BLACK_LIFT, 12);
      expect(v[400]).toBeCloseTo(y[4], 12);
      for (let i = 1; i < v.length; i += 1) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1] - 1e-12);
    }
  });
});

describe.each(['day', 'dusk', 'night'] as FixedSkyState[])('the %s curve fitted to a sky', (state) => {
  const sky = makePhysicalSky(sunOfBand(FALLBACK_VIEW.place, state, new Date('2026-06-21T10:40:00Z')), 0, FALLBACK_VIEW);
  const { camera } = windowFor(sky.view, 64, 36);
  const dome = renderDome(sky.atm, sky.sun, camera, 64, 36, sky.weather.cover, sky.night);
  const b = BUDGET[state];

  it('has the black lift constant at black and every texel inside the state budget', () => {
    const c = sky.fit.display.curve;
    expect(applyCurve(c, 0)).toBe(b.lift);
    expect(b.lift).toBe(state === 'night' ? NIGHT_LIFT : BLACK_LIFT);
    expect(sky.fit.lo).toBeGreaterThanOrEqual(b.floor);
    expect(sky.fit.hi).toBeLessThanOrEqual(b.ceiling + 0.004);
    const v = sweep(c);
    for (let i = 1; i < v.length; i += 1) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1] - 1e-12);
  });

  it('puts the sky percentiles on the targets (as far as the gain limit allows)', () => {
    const n = dome.hdr.length / 3;
    const ls: number[] = [];
    for (let i = 0; i < n; i += 1)
      ls.push(displayLumaOf(dome.hdr[i * 3], dome.hdr[i * 3 + 1], dome.hdr[i * 3 + 2], sky.fit.display));
    ls.sort((p, q) => p - q);
    const at = (q: number) => ls[Math.floor(q * n)];
    const flat = fitDisplay(state, dome.hdr, dome.meanLuma);
    expect(flat.display).toEqual(sky.fit.display);
    // The curve is fitted on luminance and applied per channel, so the byte luminance is near its targets, not on them. The median is never limited; the outer two are at or below their targets by the gain limit only.
    const p = b.partial;
    const level = p ? Math.min(p.levelMax, Math.max(p.levelMin, (dome.meanLuma / p.ref) ** (1 - p.exponent))) : 1;
    expect(at(0.5)).toBeGreaterThan(b.targets[1] * level * 0.75);
    // The scotopic grade lifts the blue channel, which the per-channel curve takes up faster than the luminance it was fitted on: night reads up to twice its target.
    const slack = p ? 2.5 : 1.25;
    expect(at(0.5)).toBeLessThan(b.targets[1] * level * slack);
    expect(at(0.95)).toBeLessThanOrEqual(b.targets[2] * level * slack + 0.004);
    expect(at(0.05)).toBeLessThan(at(0.5));
  });
});

describe('the night display', () => {
  const night = (iso: string) => {
    const t = new Date(iso);
    return makePhysicalSky(sunAt(FALLBACK_VIEW.place, t), 0, FALLBACK_VIEW);
  };
  const fullMoon = night('2026-11-24T22:00:00Z');
  const newMoon = night('2026-12-09T20:00:00Z');

  it('adapts the exposure to the sky: a moonless night is exposed far brighter than a moonlit one', () => {
    expect(fullMoon.moon.illuminated).toBeGreaterThan(0.99);
    expect(newMoon.moon.illuminated).toBeLessThan(0.1);
    expect(newMoon.fit.display.exposure).toBeGreaterThan(10 * fullMoon.fit.display.exposure);
  });

  it('reads the new-moon night darker than the full-moon night (partial adaptation), by the level of the budget', () => {
    const med = (p: ReturnType<typeof night>) => applyCurve(p.fit.display.curve, p.fit.display.curve.x[2]); // the median of the sky
    expect(med(newMoon)).toBeLessThan(0.6 * med(fullMoon));
  });

  it('grades toward the rods at night and not by day', () => {
    expect(fullMoon.fit.display.grade).toBeGreaterThan(0.8);
    expect(newMoon.fit.display.grade).toBeGreaterThan(0.99);
    expect(makePhysicalSky(sunOfBand(FALLBACK_VIEW.place, 'day', new Date('2026-06-21T10:40:00Z')), 0, FALLBACK_VIEW).fit.display.grade ?? 0).toBe(0);
  });

  it('has no fixed night ceiling: the curve tops out at NIGHT_CEILING', () => {
    expect(applyCurve(newMoon.fit.display.curve, 1)).toBe(NIGHT_CEILING);
    expect(BUDGET.night.ceiling).toBe(NIGHT_CEILING);
  });
});

describe('the scotopic grade', () => {
  it('leaves a neutral grey alone in hue, moves colour toward blue and darkens red against blue', () => {
    const o = [0, 0, 0];
    scotopic(0.2, 0.2, 0.2, 1, o);
    expect(o[0] / o[1]).toBeCloseTo(SCOTOPIC.tint[0] / SCOTOPIC.tint[1], 6);
    scotopic(0.5, 0.1, 0.1, 1, o);
    const red = [...o];
    scotopic(0.1, 0.1, 0.5, 1, o);
    expect(o[2]).toBeGreaterThan(red[2]);
    expect(red[0]).toBeLessThan(0.5); // red is nearly black to the rods
    scotopic(0.3, 0.2, 0.1, 0, o);
    expect(o).toEqual([0.3, 0.2, 0.1]);
  });
  it('weighs 1 in the dark and 0 in daylight, falling through the mesopic range', () => {
    expect(scotopicWeight(2e-9)).toBeCloseTo(1, 6);
    expect(scotopicWeight(0.3)).toBe(0);
    expect(scotopicWeight(1e-6)).toBeGreaterThan(scotopicWeight(1e-4));
  });
});
