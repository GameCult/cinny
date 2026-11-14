import { describe, expect, it } from 'vitest';
import { frameChoice } from './frameChoice';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';

const { frames } = parseManifest(wireManifest(), '/d/');
const at = (elevation: number, azimuth: number) => frameChoice(frames, { elevation, azimuth });
const keys = (c: ReturnType<typeof at>) => [c.a.key, c.b?.key ?? null];

describe('frameChoice', () => {
  it('blends continuously with elevation inside a half', () => {
    const ws = [3, 6, 9, 12, 15, 18].map((el) => at(el, 130).w);
    ws.forEach((w, i) => i && expect(w).toBeGreaterThan(ws[i - 1]));
  });

  it('weights by the elevation between the bracketing keys, a at the lower', () => {
    // Morning half: night -12, dawn 0, morning 20, noon 60. Sun 10 deg is half way from dawn to morning.
    const c = at(10, 130);
    expect(keys(c)).toEqual(['dawn', 'morning']);
    expect(c.w).toBeCloseTo(0.5, 6);
  });

  it('uses the afternoon keys after the noon azimuth and the morning keys before', () => {
    expect(keys(at(10, 130))).toEqual(['dawn', 'morning']);
    expect(keys(at(-1, 250))).toEqual(['dusk', 'golden']);
    expect(at(-1, 250).w).toBeCloseTo(1.5 / 8.5, 6);
  });

  it('noon is the same single frame from both halves', () => {
    expect(keys(at(60, 170))).toEqual(['noon', null]);
    expect(keys(at(60, 190))).toEqual(['noon', null]);
    expect(keys(at(75, 190))).toEqual(['noon', null]);
  });

  it('is the night key alone at or below its elevation, in either half', () => {
    expect(keys(at(-12, 10))).toEqual(['night', null]);
    expect(keys(at(-40, 300))).toEqual(['night', null]);
  });

  it('blends night into dawn before sunrise and dusk into night after sunset', () => {
    expect(keys(at(-6, 90))).toEqual(['night', 'dawn']);
    expect(keys(at(-6, 270))).toEqual(['night', 'dusk']);
  });

  it('collapses a blend within 2% of either end to one frame, and w stays in 0..1', () => {
    expect(keys(at(0.2, 130))).toEqual(['dawn', null]); // w = 0.01
    expect(keys(at(19.8, 130))).toEqual(['morning', null]); // w = 0.99
    const els = Array.from({ length: 325 }, (_, i) => -30 + i * 0.37);
    els.forEach((el) =>
      [0, 100, 179, 181, 270].forEach((az) => {
        const c = at(el, az);
        expect(c.w).toBeGreaterThanOrEqual(0);
        expect(c.w).toBeLessThanOrEqual(1);
        expect(c.b === null).toBe(c.w === 0);
      })
    );
  });
});
