import { describe, expect, it } from 'vitest';
import { alignTurns, panPx, plateCamera, plateSize, PLATE_MAX_PX, RECENTRE_MARGIN_DEG, recentre, SLACK_DEG } from './skyTurn';
import { FALLBACK_VIEW, SPEED_CEILING_DEG_S, windowFor } from './view';
import { RESIDENCY_MS } from './Ridge';

const win = windowFor(FALLBACK_VIEW, 1280, 720);

describe('plateCamera', () => {
  it('spans the viewport plus the slack each side about its centre, at the viewport angles per pixel', () => {
    const cam = plateCamera(win, 100);
    expect(cam.azimuthDeg).toBe(100);
    expect(cam.hfovDeg).toBeCloseTo(win.camera.hfovDeg + 2 * SLACK_DEG, 12);
    expect(SLACK_DEG).toBe(20);
    expect(cam.vfovDeg).toBe(win.camera.vfovDeg);
    expect(cam.horizonAt).toBe(win.camera.horizonAt);
    // a plate is `plateSize` wide and shows the same degrees per pixel as the viewport
    const { cssW } = plateSize(win, 1280, 720, 1);
    expect(cssW / cam.hfovDeg).toBeCloseTo(1280 / win.camera.hfovDeg, 9);
  });

  it('names its centre within one turn, whatever turn the heading owner is on', () => {
    expect(plateCamera(win, 750).azimuthDeg).toBe(30);
    expect(plateCamera(win, -10).azimuthDeg).toBe(350);
    expect(plateCamera(win, 214, 0).hfovDeg).toBe(win.camera.hfovDeg); // no slack: the viewport's own camera, as a still paints
  });
});

describe('recentre', () => {
  it('fires 14 degrees from the centre, not 5, and not for a heading that stays', () => {
    expect(RECENTRE_MARGIN_DEG).toBe(6);
    expect(recentre(100, 100)).toBe(false);
    expect(recentre(105, 100)).toBe(false);
    expect(recentre(113.9, 100)).toBe(false);
    expect(recentre(114.1, 100)).toBe(true);
    expect(recentre(85.9, 100)).toBe(true);
  });

  it('reads the heading on the turn of the centre', () => {
    expect(recentre(10 + 360, 10)).toBe(false);
    expect(recentre(350, 5)).toBe(true); // 15 degrees off, the short way
    expect(recentre(358, 5)).toBe(false);
    expect(alignTurns(10, 725)).toBe(730);
    expect(alignTurns(370, 5)).toBe(10);
  });

  it('is decided before the plate can run out between two residency ticks of the fastest turn', () => {
    expect(SPEED_CEILING_DEG_S * (RESIDENCY_MS / 1000)).toBeLessThanOrEqual(RECENTRE_MARGIN_DEG);
  });
});

describe('plateSize', () => {
  it('never has more backing store than PLATE_MAX_PX: the pixel ratio lowers, the plate does not shrink', () => {
    [
      [1280, 720, 2],
      [1920, 1080, 2],
      [3840, 2160, 1],
      [390, 844, 3],
      [800, 600, 1],
    ].forEach(([w, h, dpr]) => {
      const wn = windowFor(FALLBACK_VIEW, w, h);
      const p = plateSize(wn, w, h, dpr);
      expect(Math.floor(p.cssW * p.ratio) * Math.floor(h * p.ratio)).toBeLessThanOrEqual(PLATE_MAX_PX);
      expect(p.ratio).toBeLessThanOrEqual(dpr);
      expect(p.cssW).toBeCloseTo((w * (wn.camera.hfovDeg + 2 * SLACK_DEG)) / wn.camera.hfovDeg, 9);
    });
    // a small viewport keeps the whole device ratio, a phone-sized one at 2x loses a little of it
    expect(plateSize(windowFor(FALLBACK_VIEW, 300, 500), 300, 500, 2).ratio).toBe(2);
  });
});

describe('panPx', () => {
  it('slides the plate one for one with the heading, opposite to it', () => {
    const ppd = 1280 / win.camera.hfovDeg;
    expect(panPx(214, 214, ppd)).toBeCloseTo(0, 12);
    expect(panPx(224, 214, ppd)).toBeCloseTo(-10 * ppd, 9);
    expect(panPx(204, 214, ppd)).toBeCloseTo(10 * ppd, 9);
  });
});
