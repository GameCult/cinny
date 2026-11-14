import { describe, expect, it } from 'vitest';
import { sunOnScreen } from './skyDome';
import { DRIFT_FRAC, FALLBACK_VIEW, windowFor } from './view';
import type { View } from './view';

const VIEWPORTS: [number, number][] = [
  [390, 844],
  [1920, 1080],
  [3440, 1440],
];

describe('windowFor', () => {
  it.each(VIEWPORTS)('%i x %i: the planes cover the viewport, the camera sees only baked sky, the horizon is the plane\'s', (w, h) => {
    const v = FALLBACK_VIEW;
    const win = windowFor(v, w, h);
    expect(win.driftPx).toBeGreaterThanOrEqual(0);
    expect(win.plane.w - 2 * win.driftPx).toBeCloseTo(w, 6);
    expect(win.plane.h).toBeLessThanOrEqual(h * 4); // sanity: scale is not runaway
    // Angle seen never exceeds the baked window minus the drift margin on both sides.
    expect(win.camera.hfovDeg).toBeLessThanOrEqual(v.windowDeg / (1 + 2 * DRIFT_FRAC) + 1e-9);
    // The plane is anchored to the bottom; its horizon row lands at the camera's horizon fraction of the viewport.
    const horizonY = h - win.plane.bottom - win.plane.h + win.plane.scale * v.horizonRow;
    expect(Math.abs(horizonY - win.camera.horizonAt * h)).toBeLessThan(0.5);
    expect(win.camera.azimuthDeg).toBe(v.lookAzDeg);
    expect(win.camera.vfovDeg / win.camera.hfovDeg).toBeCloseTo(h / w, 9); // one scale on both axes
  });

  it('is shaped by the View alone: another window, plane and horizon give another camera', () => {
    const wide: View = { ...FALLBACK_VIEW, lookAzDeg: 10, windowDeg: 144, planeW: 2560, horizonRow: 200 };
    const a = windowFor(FALLBACK_VIEW, 1920, 1080).camera;
    const b = windowFor(wide, 1920, 1080).camera;
    expect(b.azimuthDeg).toBe(10);
    expect(b.horizonAt).not.toBeCloseTo(a.horizonAt, 2);
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
