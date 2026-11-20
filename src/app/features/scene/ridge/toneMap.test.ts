import { describe, expect, it } from 'vitest';
import { FALLBACK_VIEW } from './view';
import { makePhysicalSky } from './physicalSky';
import { renderDome } from './skyDome';
import { windowFor } from './view';
import { applyCurve, BLACK_LIFT, BUDGET, NIGHT_LIFT, displayLumaOf, fitDisplay, makeCurve } from './toneMap';
import type { FixedSkyState } from '../skyState';

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
  const sky = makePhysicalSky(state, new Date('2026-06-21T10:40:00Z'), 0, FALLBACK_VIEW);
  const { camera } = windowFor(sky.view, 64, 36);
  const dome = renderDome(sky.atm, sky.sun, camera, 64, 36, sky.weather.cover);
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

  it('puts the curve through the targets at the fixed knots (a night sky carries nothing to fit)', () => {
    if (!b.knots) return;
    b.knots.forEach((k, i) => expect(applyCurve(sky.fit.display.curve, k)).toBeCloseTo(b.targets[i], 9));
  });

  it.skipIf(b.knots !== undefined)('puts the sky percentiles on the targets (as far as the gain limit allows)', () => {
    const n = dome.hdr.length / 3;
    const ls: number[] = [];
    for (let i = 0; i < n; i += 1)
      ls.push(displayLumaOf(dome.hdr[i * 3], dome.hdr[i * 3 + 1], dome.hdr[i * 3 + 2], sky.fit.display));
    ls.sort((p, q) => p - q);
    const at = (q: number) => ls[Math.floor(q * n)];
    const flat = fitDisplay(state, dome.hdr, dome.meanLuma);
    expect(flat.display).toEqual(sky.fit.display);
    // The curve is fitted on luminance and applied per channel, so the byte luminance is near its targets, not on them. The median is never limited; the outer two are at or below their targets by the gain limit only.
    expect(at(0.5)).toBeGreaterThan(b.targets[1] * 0.75);
    expect(at(0.5)).toBeLessThan(b.targets[1] * 1.25);
    expect(at(0.95)).toBeLessThanOrEqual(b.targets[2] * 1.25 + 0.004);
    expect(at(0.05)).toBeLessThan(at(0.5));
  });
});
