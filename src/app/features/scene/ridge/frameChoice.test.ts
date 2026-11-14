import { describe, expect, it } from 'vitest';
import { BLEND_EDGE, crossfade, frameChoice } from './frameChoice';
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

  it("splits the halves at the noon frame's azimuth, wherever the bake put it", () => {
    const w = wireManifest() as any;
    const shifted = parseManifest(
      {
        ...w,
        frames: w.frames.map((f: any) =>
          f.key === 'noon' ? { ...f, sun: { ...f.sun, az: 170 } } : f
        ),
      },
      '/d/'
    );
    const pick = (az: number) => frameChoice(shifted.frames, { elevation: 10, azimuth: az });
    expect([pick(169).a.key, pick(169).b?.key]).toEqual(['dawn', 'morning']);
    expect([pick(171).a.key, pick(171).b?.key]).toEqual(['golden', 'noon']);
  });

  it('collapses exactly at BLEND_EDGE and no further: a blend of 3% still has two frames', () => {
    expect(BLEND_EDGE).toBe(0.02);
    // Morning half dawn 0 .. morning 20: w = el / 20.
    expect(keys(at(0.6, 130))).toEqual(['dawn', 'morning']); // w = 0.03
    expect(keys(at(19.4, 130))).toEqual(['dawn', 'morning']); // w = 0.97
    expect(keys(at(0.2, 130))).toEqual(['dawn', null]); // w = 0.01
    expect(keys(at(19.8, 130))).toEqual(['morning', null]); // w = 0.99
  });
});

describe('crossfade: the one rule of a blend', () => {
  // A baked plane is haze as alpha: no pixel opaque, the same alpha in every frame. Frames as (premultiplied) colour and alpha.
  const planeA = { c: 0.2, alpha: 0.6 };
  const planeB = { c: 0.5, alpha: 0.6 };
  const sum = (c: ReturnType<typeof at>) => {
    const f = crossfade(c);
    const b = c.b ? planeB : { c: 0, alpha: 0 };
    return { c: planeA.c * f.a + b.c * f.b, alpha: planeA.alpha * f.a + b.alpha * f.b };
  };

  it('is a lerp of the two frames: colour and haze alike, never denser than either', () => {
    [0.03, 0.2, 0.5, 0.8, 0.97].forEach((w) => {
      const c = { a: frames[0], b: frames[1], w };
      const got = sum(c);
      expect(got.c).toBeCloseTo(planeA.c * (1 - w) + planeB.c * w, 12);
      expect(got.alpha).toBeCloseTo(0.6, 12); // equal alphas stay equal: the haze is not doubled
      expect(got.alpha).toBeLessThanOrEqual(Math.max(planeA.alpha, planeB.alpha) + 1e-12);
    });
  });

  it('has no jump where the choice collapses: the blend either side of an edge is within the edge of the lone frame', () => {
    const gap = Math.abs(planeA.c - planeB.c);
    const high = sum({ a: frames[0], b: frames[1], w: 1 - BLEND_EDGE });
    const low = sum({ a: frames[0], b: frames[1], w: BLEND_EDGE });
    expect(Math.abs(high.c - planeB.c)).toBeLessThanOrEqual(BLEND_EDGE * gap + 1e-12); // collapse shows b alone
    expect(Math.abs(low.c - planeA.c)).toBeLessThanOrEqual(BLEND_EDGE * gap + 1e-12); // collapse shows a alone
    expect(high.alpha).toBeCloseTo(planeB.alpha, 12);
  });

  it('a lone frame is full weight alone', () => {
    expect(crossfade({ a: frames[0], b: null, w: 0 })).toEqual({ a: 1, b: 0 });
  });
});
