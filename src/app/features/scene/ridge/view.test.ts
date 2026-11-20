import { describe, expect, it } from 'vitest';
import { sunOnScreen } from './skyDome';
import { cardMotion, DRIFT_FRAC, FALLBACK_VIEW, HORIZON_AT, windowFor } from './view';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import type { View } from './view';

const VIEWPORTS: [number, number][] = [
  [390, 844],
  [1920, 1080],
  [3440, 1440],
];

describe('windowFor', () => {
  it.each(VIEWPORTS)(
    "%i x %i: the planes cover the viewport, the camera sees only baked sky, the horizon is the plane's",
    (w, h) => {
      const v = FALLBACK_VIEW;
      const win = windowFor(v, w, h);
      expect(win.driftPx).toBeGreaterThanOrEqual(0);
      expect(win.plane.w - 2 * win.driftPx).toBeCloseTo(w, 6);
      expect(win.plane.h).toBeLessThanOrEqual(h * 4); // sanity: scale is not runaway
      // Angle seen never exceeds the baked window minus the drift margin on both sides.
      expect(win.camera.hfovDeg).toBeLessThanOrEqual(v.windowDeg / (1 + 2 * DRIFT_FRAC) + 1e-9);
      // The plane's horizon row lands at the camera's horizon fraction of the viewport.
      const horizonY = h - win.plane.bottom - win.plane.h + win.plane.scale * v.horizonRow;
      expect(Math.abs(horizonY - win.camera.horizonAt * h)).toBeLessThan(0.5);
      expect(win.camera.azimuthDeg).toBe(v.lookAzDeg);
      expect(win.camera.vfovDeg / win.camera.hfovDeg).toBeCloseTo(h / w, 9); // one scale on both axes
    }
  );

  it('puts the horizon at one fraction of the height, whatever the viewport, the view or the sky state', () => {
    const wide: View = { ...FALLBACK_VIEW, lookAzDeg: 10, windowDeg: 144, planeW: 2560, horizonRow: 200 };
    for (const v of [FALLBACK_VIEW, wide])
      for (const [w, h] of [...VIEWPORTS, [1024, 768], [375, 812], [1100, 619]] as [number, number][])
        expect(windowFor(v, w, h).camera.horizonAt).toBe(HORIZON_AT);
    expect(HORIZON_AT).toBeGreaterThan(0.5);
    expect(HORIZON_AT).toBeLessThan(1);
  });

  it('shows about 35 degrees of sky above the horizon in a 16:9 desktop cell', () => {
    const { camera } = windowFor(FALLBACK_VIEW, 1100, 619);
    const sky = camera.horizonAt * camera.vfovDeg;
    expect(sky).toBeGreaterThan(33);
    expect(sky).toBeLessThan(40);
  });

  it.each([
    [1024, 768],
    [1920, 1080],
    [375, 812],
    [1100, 619],
  ])('%i x %i: the plane covers the viewport bottom and sides, drift included, with baked ground to spare below the horizon', (w, h) => {
    const win = windowFor(FALLBACK_VIEW, w, h);
    expect(win.plane.bottom).toBeLessThanOrEqual(0); // the foot of the plane is at or below the viewport's bottom edge
    expect(win.plane.w - 2 * win.driftPx).toBeCloseTo(w, 6);
    expect(win.driftPx).toBeGreaterThanOrEqual(0);
    // The baked ground below the horizon row that the viewport crops to: more than the viewport needs.
    const needed = (1 - HORIZON_AT) * h;
    const baked = win.plane.scale * (FALLBACK_VIEW.planeH - FALLBACK_VIEW.horizonRow);
    expect(baked).toBeGreaterThanOrEqual(needed);
  });

  it('is shaped by the View alone: another window and plane give another camera (azimuth and field of view; the horizon stays put)', () => {
    const wide: View = {
      ...FALLBACK_VIEW,
      lookAzDeg: 10,
      windowDeg: 144,
      planeW: 2560,
      horizonRow: 200,
    };
    const a = windowFor(FALLBACK_VIEW, 1920, 1080).camera;
    const b = windowFor(wide, 1920, 1080).camera;
    expect(b.azimuthDeg).toBe(10);
    expect(windowFor(FALLBACK_VIEW, 1920, 1080).camera.hfovDeg).not.toBeCloseTo(windowFor(wide, 1920, 1080).camera.hfovDeg, 2);
    expect(b.horizonAt).toBe(a.horizonAt);
  });

  it('registration: a sun 10 degrees right of the look azimuth sits where the plane puts that azimuth', () => {
    for (const [w, h] of VIEWPORTS) {
      const v = FALLBACK_VIEW;
      const win = windowFor(v, w, h);
      const sun = { elevation: 12, azimuth: v.lookAzDeg + 10, time: new Date(0) };
      const at = sunOnScreen(sun, win.camera)!;
      const planeX = w / 2 + 10 * v.pxPerDegH * win.plane.scale; // plane centred on lookAz
      expect(Math.abs(at.x * w - planeX)).toBeLessThan(0.5);
      // and its height above the ridge's horizon is 12 degrees of plane pixels
      const planeY = win.camera.horizonAt * h - 12 * v.pxPerDegH * win.plane.scale;
      expect(Math.abs(at.y * h - planeY)).toBeLessThan(0.5);
    }
  });

  it('the sun is seen across north: azimuths wrap', () => {
    const v: View = { ...FALLBACK_VIEW, lookAzDeg: 355 };
    const win = windowFor(v, 1920, 1080);
    const at = sunOnScreen({ elevation: 10, azimuth: 5, time: new Date(0) }, win.camera)!;
    expect(Math.abs(at.x * 1920 - (960 + 10 * v.pxPerDegH * win.plane.scale))).toBeLessThan(0.5);
  });

  it('the sun does not turn the camera: the same camera for any sun', () => {
    expect(windowFor(FALLBACK_VIEW, 1280, 720).camera.azimuthDeg).toBe(FALLBACK_VIEW.lookAzDeg);
  });
});

describe('cardMotion', () => {
  const manifest = parseManifest(wireManifest(), '/d/'); // scales 1.2, 1.0167, 1.005; heading range 23 deg; 1280 px plane, 17.78 px per degree
  const motion = (w: number, h: number) => cardMotion(manifest, windowFor(manifest.view, w, h));

  it('turns the whole baked range on a phone and is capped by coverage on a wide screen', () => {
    expect(motion(390, 844).headingDeg).toBe(23);
    expect(motion(1920, 1080).headingDeg).toBeCloseTo(3.4, 1);
    expect(motion(768, 1024).headingDeg).toBeLessThan(23);
    expect(motion(768, 1024).headingDeg).toBeGreaterThan(motion(1920, 1080).headingDeg);
  });

  it.each([
    [390, 844],
    [768, 1024],
    [1920, 1080],
    [3440, 1440],
  ])(
    '%i x %i: every card still covers the viewport at the end of the drift, and the cap is exact for the card that gives out first',
    (w, h) => {
      const win = windowFor(manifest.view, w, h);
      const { headingDeg } = cardMotion(manifest, win);
      const half = w / 2 / win.plane.scale;
      const slack = manifest.cards.map(
        (c) => manifest.view.planeW / 2 - half / c.scale - headingDeg * manifest.view.pxPerDegH
      );
      slack.forEach((s) => expect(s).toBeGreaterThanOrEqual(-1e-6));
      if (headingDeg < manifest.camera.headingMaxDeg) expect(Math.min(...slack)).toBeCloseTo(0, 6);
    }
  );

  it('pans card i by scale_i x heading and keeps the scales the manifest gave', () => {
    const win = windowFor(manifest.view, 390, 844);
    const m = cardMotion(manifest, win);
    expect(m.cards.map((c) => c.scale)).toEqual([1.2, 1.0167, 1.005]);
    m.cards.forEach((c) =>
      expect(c.reachPx).toBeCloseTo(c.scale * 23 * manifest.view.pxPerDegH * win.plane.scale, 6)
    );
    // The nearer a card, the faster it pans.
    expect(m.cards[0].reachPx).toBeGreaterThan(m.cards[1].reachPx);
    expect(m.cards[1].reachPx).toBeGreaterThan(m.cards[2].reachPx);
  });

  it('a wider baker range moves a phone further, a narrower one less', () => {
    const win = windowFor(manifest.view, 390, 844);
    const at = (deg: number) => cardMotion({ ...manifest, camera: { headingMaxDeg: deg } }, win);
    expect(at(10).headingDeg).toBe(10);
    expect(at(40).headingDeg).toBeLessThan(40); // the phone's coverage gives out first
    expect(at(10).cards[0].reachPx).toBeLessThan(at(20).cards[0].reachPx);
  });
});
