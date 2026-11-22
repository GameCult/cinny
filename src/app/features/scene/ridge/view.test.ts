import { describe, expect, it } from 'vitest';
import {
  cardArc,
  cardPose,
  FALLBACK_VIEW,
  HFOV_MAX_DEG,
  HORIZON_AT,
  offsetRange,
  RIDGE_BAND_FRAC,
  windowFor,
} from './view';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import type { View } from './view';

const VIEWPORTS: [number, number][] = [
  [390, 844],
  [1920, 1080],
  [3440, 1440],
];

const manifest = parseManifest(wireManifest(), '/d/'); // distances: card 0 1000-1400 m, card 1 10-14 km, card 2 39-41 km
const withView = (over: Record<string, unknown>) =>
  parseManifest(wireManifest({ view: { ...(wireManifest().view as object), ...over } }), '/d/');
const DEG = Math.PI / 180;

describe('windowFor', () => {
  it('gives a 16:9 viewport the scale and the 65.45 degrees it had when a window was baked, and a phone the band scale', () => {
    const v = FALLBACK_VIEW;
    const wide = windowFor(v, 1920, 1080);
    expect(wide.plane.scale).toBeCloseTo((1920 * 1.1) / 1280, 9);
    expect(wide.camera.hfovDeg).toBeCloseTo(72 / 1.1, 9);
    expect(HFOV_MAX_DEG).toBeCloseTo(65.4545, 4);
    const phone = windowFor(v, 390, 844);
    expect(phone.plane.scale).toBeCloseTo((RIDGE_BAND_FRAC * 844) / v.planeH, 9);
    expect(phone.camera.hfovDeg).toBeCloseTo(390 / (phone.plane.scale * v.pxPerDegH), 9);
  });

  it.each(VIEWPORTS)(
    "%i x %i: the camera never sees more than the widest field, the horizon is the plane's, the plane reaches the bottom",
    (w, h) => {
      const v = FALLBACK_VIEW;
      const win = windowFor(v, w, h);
      expect(win.camera.hfovDeg).toBeLessThanOrEqual(HFOV_MAX_DEG + 1e-9);
      expect(win.plane.h).toBeLessThanOrEqual(h * 4); // sanity: scale is not runaway
      const horizonY = h - win.plane.bottom - win.plane.h + win.plane.scale * v.horizonRow;
      expect(Math.abs(horizonY - win.camera.horizonAt * h)).toBeLessThan(0.5);
      expect(win.camera.azimuthDeg).toBe(v.lookAzDeg);
      expect(win.camera.vfovDeg / win.camera.hfovDeg).toBeCloseTo(h / w, 9); // one scale on both axes
      expect(win.plane.bottom).toBeLessThanOrEqual(0);
    }
  );

  it('puts the horizon at one fraction of the height, whatever the viewport or the view', () => {
    const other: View = { ...FALLBACK_VIEW, lookAzDeg: 10, horizonRow: 200, pxPerDegH: 10 };
    for (const v of [FALLBACK_VIEW, other])
      for (const [w, h] of [...VIEWPORTS, [1024, 768], [375, 812], [1100, 619]] as [number, number][])
        expect(windowFor(v, w, h).camera.horizonAt).toBe(HORIZON_AT);
    expect(HORIZON_AT).toBeGreaterThan(0.5);
    expect(HORIZON_AT).toBeLessThan(1);
  });

  it('shows about 31 degrees of sky above the horizon in a 16:9 desktop cell', () => {
    const { camera } = windowFor(FALLBACK_VIEW, 1100, 619);
    const sky = camera.horizonAt * camera.vfovDeg;
    expect(sky).toBeGreaterThan(29);
    expect(sky).toBeLessThan(34);
  });

  it('points the camera at the rest azimuth, and a north-crossing one is not wrapped', () => {
    expect(windowFor({ ...FALLBACK_VIEW, lookAzDeg: 355 }, 1920, 1080).camera.azimuthDeg).toBe(355);
  });
});

describe('cardPose', () => {
  const win = windowFor(manifest.view, 1920, 1080);
  const rest = manifest.view.lookAzDeg;
  const k = win.plane.scale * manifest.view.pxPerDegH;

  it('at phi 0 is the tangent R / (R - r) the camera pushed forward gives, a card pans with the heading, and the offset 0 leaves it at scale 1', () => {
    // Heading 135 is tile 1's centre: card 1 stands 12 km away there.
    const p = cardPose(manifest, 1, 135, 0, 200, win);
    expect(p.scale).toBeCloseTo(12000 / (12000 - 200), 2);
    expect(Math.abs(p.scale - 12000 / (12000 - 200))).toBeLessThan(0.002);
    const flat = cardPose(manifest, 1, 135, 0, 0, win);
    expect(flat.scale).toBeCloseTo(1, 9);
    // The column the view faces lands on the centre: at scale s the container shifts by -s (h - rest) k.
    expect(flat.shiftPx).toBeCloseTo(-(135 - rest) * k, 6);
  });

  it('is mirrored behind the centre: a backward offset shrinks the card and a larger one shrinks it more', () => {
    const fwd = cardPose(manifest, 0, 45, 0, 100, win).scale;
    const back = cardPose(manifest, 0, 45, 0, -100, win).scale;
    expect(fwd).toBeGreaterThan(1);
    expect(back).toBeLessThan(1);
    expect(cardPose(manifest, 0, 45, 0, -200, win).scale).toBeLessThan(back);
  });

  it('at phi 90 shifts the card sideways by r / R x 57.3 degrees and leaves its size alone', () => {
    const at = (phi: number) => cardPose(manifest, 1, 135, phi, 200, win);
    const p = at(90);
    // The sideways part of a pose: where the line meets the heading's own column, a0 = shift / k + s (h - rest).
    const a0 = (q: { scale: number; shiftPx: number }) => q.shiftPx / k + q.scale * (135 - rest);
    expect(a0(at(0))).toBeCloseTo(0, 6);
    // A camera to the clockwise side of the heading (east of a north view) sees the card to the left of it, and one on the other side to the right.
    expect(a0(p)).toBeLessThan(0);
    expect(a0(at(-90))).toBeGreaterThan(0);
    // r / R x 57.3 degrees at the heading's own column; the line fitted over the arc takes the mean of cos over it, about 0.93 of that.
    const centre = (200 / 12000) * (180 / Math.PI);
    expect(Math.abs(a0(p)) / centre).toBeGreaterThan(0.9);
    expect(Math.abs(a0(p)) / centre).toBeLessThanOrEqual(1);
    expect(p.scale).toBeCloseTo(1, 2);
  });

  it('is the same at a heading and a revolution on: nothing about it wraps', () => {
    const a = cardPose(manifest, 0, 100, 10, 80, win);
    const b = cardPose(manifest, 0, 100 + 360, 10, 80, win);
    expect(b.scale).toBeCloseTo(a.scale, 9);
    // The unwrapped heading moves the container a revolution, which is what keeps the tiles at their unwrapped azimuth.
    expect(b.shiftPx - a.shiftPx).toBeCloseTo(-a.scale * 360 * k, 4);
  });

  it('is exact where the sheet is: a card seen from its own circle lands on the line it fits', () => {
    // The fitted line passes through the exact angle at the middle of the arc within a card pixel at a small offset.
    const R = 12000;
    const r = 150;
    const p = cardPose(manifest, 1, 135, 0, r, win);
    const exact = Math.atan2(R * Math.sin(10 * DEG), R * Math.cos(10 * DEG) - r) / DEG;
    const line = (p.shiftPx / k + p.scale * (135 - rest)) + p.scale * 10;
    expect(Math.abs(exact - line) * k).toBeLessThan(0.5);
  });
});

describe('cardArc', () => {
  const win = windowFor(manifest.view, 1920, 1080);
  it('is the viewport arc at the rest heading with no offset, and follows the heading and the scale', () => {
    const rest = manifest.view.lookAzDeg;
    const half = win.camera.hfovDeg / 2;
    const flat = cardArc(manifest.view, win, 1920, cardPose(manifest, 1, rest, 0, 0, win));
    expect(flat.fromDeg).toBeCloseTo(rest - half, 6);
    expect(flat.toDeg).toBeCloseTo(rest + half, 6);
    const turned = cardArc(manifest.view, win, 1920, cardPose(manifest, 1, rest + 400, 0, 0, win));
    expect(turned.fromDeg).toBeCloseTo(rest + 400 - half, 6);
    // A card that is larger on screen shows less of itself.
    const near = cardPose(manifest, 0, 45, 0, 100, win);
    const arc = cardArc(manifest.view, win, 1920, near);
    expect(arc.toDeg - arc.fromDeg).toBeCloseTo((2 * half) / near.scale, 6);
  });
});

describe('offsetRange', () => {
  it('never exceeds the bake, and is symmetric while the nearest card keeps its foot under the viewport bottom', () => {
    for (const [w, h] of VIEWPORTS) {
      const [lo, hi] = offsetRange(manifest, windowFor(manifest.view, w, h));
      expect(hi).toBe(manifest.camera.rMaxM);
      expect(lo).toBe(-manifest.camera.rMaxM);
    }
  });

  it('gives up part of its backward half where the nearest card shrunk by R / (R + r) would lift its foot above the viewport bottom, and all of it past that', () => {
    // 1920 x 1080: keep = (1 - HORIZON_AT) 1080 / (scale (planeH - horizonRow)). Put the horizon row so that keep is 0.95, and the nearest card is 1000 m away.
    const scale = windowFor(manifest.view, 1920, 1080).plane.scale;
    const near = withView({ horizon_row: 600 - (0.15 * 1080) / 0.95 / scale });
    const win = windowFor(near.view, 1920, 1080);
    const [lo, hi] = offsetRange(near, win);
    expect(hi).toBe(100);
    expect(lo).toBeCloseTo(-1000 * (1 / 0.95 - 1), 6);
    // At that offset the card's foot is exactly at the viewport bottom.
    const s = 1000 / (1000 - lo);
    expect(s * win.plane.scale * (near.view.planeH - near.view.horizonRow)).toBeCloseTo(0.15 * 1080, 6);
    const none = withView({ horizon_row: 599 });
    expect(offsetRange(none, windowFor(none.view, 1920, 1080))).toEqual([-0, 100]);
  });
});
