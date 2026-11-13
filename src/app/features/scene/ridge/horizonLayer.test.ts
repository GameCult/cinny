import { describe, expect, it } from 'vitest';
import { hfovDeg, horizonShape } from './horizon';
import { HORIZON_TRACK_SHIFT, LAYERS, layerProfile, profile } from './ridgeWorld';
import { layerPaint } from './ridgeBake';
import { weatherOf } from './weather';
import { skyColours } from './skyColour';
import { makePhysicalSky } from './physicalSky';
import { VFOV_DEG } from './skyDome';

describe('the horizon layer', () => {
  const far = LAYERS[0];
  const view = { azimuthDeg: 200, hfovDeg: hfovDeg(16 / 9, VFOV_DEG) };

  it('is the farthest layer, real and standing still', () => {
    expect(far.horizon).toBe(true);
    expect(Number.isFinite(far.seconds)).toBe(false);
    expect(LAYERS.slice(1).every((l) => !l.horizon && Number.isFinite(l.seconds))).toBe(true);
  });

  it('reads world-x as azimuth across the viewport: the left edge is half the field to the left of the view, the right edge half to the right', () => {
    const left = layerProfile(far, HORIZON_TRACK_SHIFT, view);
    const right = layerProfile(far, HORIZON_TRACK_SHIFT + 1, view);
    expect(left).toBeCloseTo(horizonShape(200 - view.hfovDeg / 2), 9);
    expect(right).toBeCloseTo(horizonShape(200 + view.hfovDeg / 2), 9);
  });

  it('stays in 0..1 and covers a real range of shape, not a line', () => {
    const v = Array.from({ length: 200 }, (_, i) =>
      layerProfile(far, -0.06 + (i / 200) * 1.2, { azimuthDeg: 305, hfovDeg: view.hfovDeg })
    );
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
    expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.2);
  });

  it('is the noise profile for the other layers, and for the horizon layer when no view is known', () => {
    expect(layerProfile(LAYERS[2], 0.4, view)).toBe(profile(LAYERS[2], 0.4));
    expect(layerProfile(far, 0.4)).toBe(profile(far, 0.4));
  });

  it('the horizontal field of a 1:1 view is the vertical one, and grows with the aspect', () => {
    expect(hfovDeg(1, VFOV_DEG)).toBeCloseTo(VFOV_DEG, 9);
    expect(hfovDeg(16 / 9, VFOV_DEG)).toBeGreaterThan(VFOV_DEG);
  });
});

describe('weather in the layers', () => {
  it("mist multiplies the layers' own, and clear air leaves it alone", () => {
    const base = skyColours();
    const day = new Date('2026-06-21T10:40:00Z');
    const clear = layerPaint(LAYERS[1], { ...base, physical: makePhysicalSky('day', day, 0) });
    const misty = layerPaint(LAYERS[1], { ...base, physical: makePhysicalSky('day', day, 0.8) });
    expect(clear.mistK).toBe(1);
    expect(misty.mistK).toBeGreaterThan(2);
    expect(layerPaint(LAYERS[1], base).mistK).toBe(1);
  });
});

describe('the weather number', () => {
  it('a number that is not finite is a clear sky, not an error', () => {
    expect(weatherOf(Number.NaN).value).toBe(0);
    expect(weatherOf(Infinity).value).toBe(0);
    expect(weatherOf(0.5).value).toBe(0.5);
  });
});
