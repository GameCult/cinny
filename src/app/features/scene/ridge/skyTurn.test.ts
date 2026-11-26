import { describe, expect, it } from 'vitest';
import {
  alignTurns,
  LATENESS_S,
  marginFor,
  MIN_TRAVEL_DEG,
  panPx,
  plateCamera,
  plateSize,
  PLATE_MAX_PX,
  recentre,
  SLACK_MIN_DEG,
  slackFor,
  TRAVEL_DEG,
} from './skyTurn';
import { FALLBACK_VIEW, SPEED_CEILING_DEG_S, windowFor } from './view';
import { RESIDENCY_MS } from './Ridge';

const win = windowFor(FALLBACK_VIEW, 1280, 720);

describe('plateCamera', () => {
  it('spans the viewport plus the slack each side about its centre, at the viewport angles per pixel', () => {
    const cam = plateCamera(win, 100, SLACK_MIN_DEG);
    expect(cam.azimuthDeg).toBe(100);
    expect(cam.hfovDeg).toBeCloseTo(win.camera.hfovDeg + 2 * SLACK_MIN_DEG, 12);
    expect(cam.vfovDeg).toBe(win.camera.vfovDeg);
    expect(cam.horizonAt).toBe(win.camera.horizonAt);
    // a plate is `plateSize` wide and shows the same degrees per pixel as the viewport
    const { cssW } = plateSize(win, 1280, 720, 1, SLACK_MIN_DEG);
    expect(cssW / cam.hfovDeg).toBeCloseTo(1280 / win.camera.hfovDeg, 9);
  });

  it('names its centre within one turn, whatever turn the heading owner is on', () => {
    expect(plateCamera(win, 750, SLACK_MIN_DEG).azimuthDeg).toBe(30);
    expect(plateCamera(win, -10, SLACK_MIN_DEG).azimuthDeg).toBe(350);
    expect(plateCamera(win, 214, 0).hfovDeg).toBe(win.camera.hfovDeg); // no slack: the viewport's own camera, as a still paints
  });
});

describe('recentre', () => {
  const still = (heading: number, centre: number, slack = SLACK_MIN_DEG) => recentre(heading, centre, slack, 0, RESIDENCY_MS);

  it('fires at the slack for a heading that does not turn, and not for one that stays', () => {
    expect(still(100, 100)).toBe(false);
    expect(still(119.9, 100)).toBe(false);
    expect(still(120.1, 100)).toBe(true);
    expect(still(80.1, 100)).toBe(false);
    expect(still(79.9, 100)).toBe(true);
  });

  it('takes the margin from the speed in force and the tick: a faster turn is replaced sooner, a slower tick sooner too', () => {
    const slack = slackFor(4, RESIDENCY_MS); // 4 degrees a second: margin 10 in 2.5 s
    expect(marginFor(4, RESIDENCY_MS)).toBeCloseTo(4 * (LATENESS_S + 0.5), 12);
    expect(recentre(100 + slack - 10.1, 100, slack, 4, RESIDENCY_MS)).toBe(false);
    expect(recentre(100 + slack - 9.9, 100, slack, 4, RESIDENCY_MS)).toBe(true);
    expect(recentre(100 + slack - 10.1, 100, slack, 4, 1500)).toBe(true); // a tick that really took 1.5 s: margin 14
    expect(recentre(100 + slack - 10.1, 100, slack, 0, RESIDENCY_MS)).toBe(false);
  });

  it('never takes the whole slack: a plate just painted is not due again whatever the tick', () => {
    expect(recentre(100, 100, SLACK_MIN_DEG, 12, 60_000)).toBe(false);
    expect(recentre(100 + MIN_TRAVEL_DEG - 0.1, 100, SLACK_MIN_DEG, 12, 60_000)).toBe(false);
    expect(recentre(100 + MIN_TRAVEL_DEG + 0.1, 100, SLACK_MIN_DEG, 12, 60_000)).toBe(true);
  });

  it('reads the heading on the turn of the centre', () => {
    expect(still(10 + 360, 10)).toBe(false);
    expect(still(350, 5, 14)).toBe(true); // 15 degrees off, the short way
    expect(still(358, 5)).toBe(false);
    expect(alignTurns(10, 725)).toBe(730);
    expect(alignTurns(370, 5)).toBe(10);
  });
});

describe('the slack at the speed in force', () => {
  const speeds = [0, 0.6, 4, 6, SPEED_CEILING_DEG_S];

  it('holds the margin and the travel between replacements, at every speed, and is the floor when the view barely turns', () => {
    for (const v of speeds) {
      const slack = slackFor(v, RESIDENCY_MS);
      expect(slack).toBeGreaterThanOrEqual(SLACK_MIN_DEG);
      expect(slack).toBeGreaterThanOrEqual(marginFor(v, RESIDENCY_MS) + TRAVEL_DEG);
    }
    expect(slackFor(0, RESIDENCY_MS)).toBe(SLACK_MIN_DEG);
    expect(slackFor(SPEED_CEILING_DEG_S, RESIDENCY_MS)).toBe(TRAVEL_DEG + SPEED_CEILING_DEG_S * (LATENESS_S + RESIDENCY_MS / 1000));
  });

  it('is never run out between two ticks, in the worst phase, with a late tick, at every speed: a tick that finds the plate whole is followed by one that does too', () => {
    for (const v of speeds) {
      for (const periodMs of [RESIDENCY_MS, 700]) {
        const slack = slackFor(v, RESIDENCY_MS);
        // The farthest from its centre a heading can be at a tick that leaves the plate alone, found by walking out from the centre.
        let edge = 0;
        while (!recentre(100 + edge + 0.001, 100, slack, v, periodMs)) edge += 0.001;
        // The next tick comes a period later and as late as the budget lets it be.
        const worst = edge + v * (periodMs / 1000 + LATENESS_S);
        expect(worst).toBeLessThanOrEqual(slack + 1e-6);
      }
    }
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
      const p = plateSize(wn, w, h, dpr, SLACK_MIN_DEG);
      expect(Math.floor(p.cssW * p.ratio) * Math.floor(h * p.ratio)).toBeLessThanOrEqual(PLATE_MAX_PX);
      expect(p.ratio).toBeLessThanOrEqual(dpr);
      expect(p.cssW).toBeCloseTo((w * (wn.camera.hfovDeg + 2 * SLACK_MIN_DEG)) / wn.camera.hfovDeg, 9);
    });
    // a small viewport keeps the whole device ratio, a phone-sized one at 2x loses a little of it
    expect(plateSize(windowFor(FALLBACK_VIEW, 300, 500), 300, 500, 2, SLACK_MIN_DEG).ratio).toBe(2);
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
