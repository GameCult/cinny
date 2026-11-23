import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchor, EASE_MS, easeEndsAt, freeze, headingAt, hold, normalize, phiAt, resetHeading, setSpeedLimit, shownPhiAt, subscribe } from './heading';
import { effectiveMode, getCamera, isHeld, resetCamera, setCamera, subscribe as onCamera } from '../cameraState';
import { maxSpeed } from './view';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';

const S = 1000;

/** The viewer's choice, at the clock `at` (ms): the one way the mode and the speed reach the view. */
const choose = (mode: 'still' | 'offset' | 'both', speedDegPerS: number, at: number) =>
  setCamera({ mode, speedDegPerS }, at);

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  resetCamera();
  resetHeading();
  setCamera({ mode: 'still', speedDegPerS: 0 }, 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the heading owner', () => {
  it('faces nothing in particular until a place anchors it, and turns nothing while the viewer chose nothing to turn', () => {
    expect(headingAt(5 * S)).toBe(0);
    expect(phiAt(5 * S)).toBe(0);
  });

  it('anchors a place at its rest azimuth once, and a later anchor of the same place changes nothing', () => {
    anchor('vienna', 214, 0);
    expect(headingAt(0)).toBe(214);
    choose('both', 0.6, 0);
    expect(headingAt(10 * S)).toBeCloseTo(220, 9);
    anchor('vienna', 214, 10 * S); // a rebuild for a new sky: the view keeps the direction it has turned to
    expect(headingAt(10 * S)).toBeCloseTo(220, 9);
    anchor('fuji', 100, 10 * S); // another place faces its own rest azimuth, with the camera on its heading
    expect(headingAt(10 * S)).toBe(100);
    expect(phiAt(10 * S)).toBe(0);
  });

  it('is unwrapped over several revolutions between normalizations: nothing wraps or clamps it', () => {
    anchor('p', 0, 0);
    choose('both', 6, 0);
    expect(headingAt(60 * S)).toBeCloseTo(360, 9);
    expect(headingAt(210 * S)).toBeCloseTo(1260, 9);
    choose('both', -6, 210 * S);
    expect(headingAt(330 * S)).toBeCloseTo(540, 9);
    expect(headingAt(500 * S)).toBeLessThan(0);
  });

  it('turns the view direction in both mode, the camera on its circle alone in offset mode, and nothing when still', () => {
    anchor('p', 100, 0);
    choose('both', 2, 0);
    expect([headingAt(10 * S), phiAt(10 * S)]).toEqual([120, 0]);
    choose('offset', 2, 10 * S); // nothing jumps at the change
    expect([headingAt(10 * S), phiAt(10 * S)]).toEqual([120, 0]);
    expect([headingAt(20 * S), phiAt(20 * S)]).toEqual([120, 20]);
    choose('still', 2, 20 * S);
    expect([headingAt(99 * S), phiAt(99 * S)]).toEqual([120, 20]);
    choose('offset', 2, 99 * S); // the camera keeps the angle it stopped at, and goes on from there
    expect([headingAt(104 * S), phiAt(104 * S)]).toEqual([120, 30]);
  });

  it('puts the camera back on its heading when the view direction is made to turn with it', () => {
    anchor('p', 100, 0);
    choose('offset', 2, 0);
    expect(phiAt(10 * S)).toBe(20);
    choose('both', 2, 10 * S); // phi is 0 in every mode where the offset turns with the view: the range the baker ships for that relies on it
    expect([headingAt(10 * S), phiAt(10 * S)]).toEqual([100, 0]);
    expect([headingAt(20 * S), phiAt(20 * S)]).toEqual([120, 0]);
  });

  it('a speed change takes effect from now, without moving the view', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    choose('both', 3, 10 * S);
    expect(headingAt(10 * S)).toBe(10);
    expect(headingAt(20 * S)).toBe(40);
  });

  it('a manual turn sets the view direction in every mode and stops the rotation: the hold is the one fact, the chosen mode is left alone', () => {
    for (const mode of ['still', 'offset', 'both'] as const) {
      resetHeading();
      anchor('p', 0, 0);
      choose(mode, 1, 0);
      hold(300, 10 * S);
      expect(headingAt(10 * S)).toBe(300);
      expect(getCamera().mode).toBe(mode);
      expect(effectiveMode()).toBe('still');
      expect(headingAt(500 * S)).toBe(300);
      expect(phiAt(500 * S)).toBe(phiAt(10 * S));
      choose('both', 1, 500 * S); // a rotation mode chosen again resumes it
      expect(headingAt(510 * S)).toBe(310);
    }
  });

  it('a hold outlives a rebuild and not a reload: a reload is a Return, and rotation resumes in the chosen mode', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    hold(100, 10 * S);
    anchor('p', 0, 20 * S); // what every scene build does
    expect(headingAt(60 * S)).toBe(100);
    expect(isHeld()).toBe(true);
    const stored = getCamera();
    expect(stored.mode).toBe('both'); // what is stored is what the viewer chose
    resetCamera(); // a reload reads the stored choice
    expect(getCamera()).toEqual(stored);
    expect(isHeld()).toBe(false);
    expect(effectiveMode()).toBe('both');
    resetHeading();
    anchor('p', 0, 100 * S); // the new page faces its rest azimuth and turns
    expect(headingAt(110 * S)).toBe(10);
  });

  it('bounds the speed at read for the mode and the place and never rewrites the stored one: switching to a mode with room restores it', () => {
    const ring = parseManifest(wireManifest({}, 3, 32), '/d/');
    const slow = maxSpeed(ring, 'both');
    anchor('p', 0, 0);
    choose('both', 50, 0);
    setSpeedLimit((m) => maxSpeed(ring, m), 0);
    expect(headingAt(10 * S)).toBeCloseTo(10 * slow, 9);
    expect(getCamera().speedDegPerS).toBe(50); // the viewer's value
    choose('offset', 50, 10 * S);
    expect(phiAt(11 * S)).toBeCloseTo(12, 9); // the ceiling of that mode, not the turning mode's bound
    choose('both', 50, 11 * S);
    expect(headingAt(21 * S) - headingAt(11 * S)).toBeCloseTo(10 * slow, 9);
    expect(getCamera().speedDegPerS).toBe(50);
    setCamera({ speedDegPerS: -50 }, 21 * S);
    expect(headingAt(31 * S) - headingAt(21 * S)).toBeCloseTo(-10 * slow, 9);
  });

  it('choosing the mode the viewer had before a hold resumes the view: the mode they had is not still any more, so the choice is a change', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    hold(100, 10 * S);
    setCamera({ mode: 'both' }, 20 * S);
    expect(headingAt(30 * S)).toBe(110);
    expect(getCamera().mode).toBe('both');
  });

  it('keeps the heading when the scene is rebuilt: the module outlives it', () => {
    anchor('p', 50, 0);
    choose('both', 1, 0);
    expect(headingAt(30 * S)).toBe(80);
    anchor('p', 50, 30 * S);
    expect(headingAt(30 * S)).toBe(80);
  });

  it('freezes under reduced motion without moving the view, and goes on from where it stopped', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    freeze(true, 10 * S);
    expect(headingAt(10 * S)).toBe(10);
    expect(headingAt(50 * S)).toBe(10);
    expect(getCamera().mode).toBe('both'); // the viewer's choice is untouched
    freeze(false, 50 * S);
    expect(headingAt(60 * S)).toBe(20);
  });

  it('normalizes into [0, 360) without changing the view, so the angles never grow with uptime', () => {
    anchor('p', 0, 0);
    choose('both', 6, 0);
    const day = 24 * 3600 * S;
    normalize(day);
    const h = headingAt(day);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(h).toBeCloseTo((6 * 86400) % 360, 6);
    expect(headingAt(day + 30 * S)).toBeCloseTo(h + 180, 6);
    choose('offset', 6, day + 30 * S);
    normalize(day + 100 * S);
    expect(phiAt(day + 100 * S)).toBeGreaterThanOrEqual(0);
    expect(phiAt(day + 100 * S)).toBeLessThan(360);
    setCamera({ speedDegPerS: -6 }, day + 100 * S);
    normalize(day + 101 * S);
    expect(phiAt(day + 101 * S)).toBeGreaterThanOrEqual(0); // a turn the other way is brought into range too
  });

  it('tells subscribers of a manual turn while still and of a new place, and of nothing that changes nothing; the viewer choice has its own channel', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    anchor('p', 0, 0);
    expect(cb).toHaveBeenCalledTimes(1);
    anchor('p', 0, 1);
    expect(cb).toHaveBeenCalledTimes(1);
    hold(5, 2); // takes the hold: the camera's listeners hear that, once
    expect(cb).toHaveBeenCalledTimes(1);
    hold(6, 3); // turned again by hand while held: told here
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    anchor('q', 0, 5);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('bounds the speed from the anchor, before anything has been told the place is loaded: a stored speed above the bound does not run over the load', () => {
    const ring = parseManifest(wireManifest({}, 3, 32), '/d/');
    const slow = maxSpeed(ring, 'both');
    setCamera({ mode: 'both', speedDegPerS: 12 }, 0);
    anchor('p', 214, 0, (m) => maxSpeed(ring, m)); // what a scene start does, then awaits the first tiles
    expect(headingAt(5 * S)).toBeCloseTo(214 + 5 * slow, 9);
    expect(slow).toBeLessThan(12);
    anchor('p', 214, 5 * S, (m) => maxSpeed(ring, m)); // a rebuild keeps the heading and the bound
    expect(headingAt(10 * S)).toBeCloseTo(214 + 10 * slow, 9);
  });

  it('settles before a listener that was added after it reads it, however often the place is anchored again', () => {
    setCamera({ mode: 'both', speedDegPerS: 1 }, 0);
    anchor('p', 214, 0);
    let read = NaN;
    const off = onCamera((_next, _prev, at) => (read = headingAt(at))); // the old rig: subscribed after the owner
    anchor('p', 214, 1 * S); // a rebuild for a sky re-binds the owner: it must keep its place in the order
    setCamera({ mode: 'still' }, 2 * S);
    expect(read).toBeCloseTo(214 + 2, 9); // the heading at the change, not the one the last settle left
    off();
  });

  it('eases a pick of the turning mode: the angle shown starts where the viewer saw it and ends where the camera goes, the kinematics never wait for it', () => {
    anchor('p', 100, 0);
    choose('offset', 12, 0);
    expect(phiAt(7.5 * S)).toBeCloseTo(90, 9);
    choose('both', 12, 7.5 * S);
    const at = 7.5 * S;
    expect(phiAt(at)).toBe(0); // where it is going
    expect(shownPhiAt(at)).toBeCloseTo(90, 9); // what is seen at the instant of the pick
    expect(easeEndsAt()).toBe(at + EASE_MS);
    const shown = [0, 0.25, 0.5, 0.75, 1].map((x) => shownPhiAt(at + x * EASE_MS));
    shown.slice(1).forEach((v, i) => expect(v).toBeLessThan(shown[i]));
    expect(shown[4]).toBe(0);
    expect(shownPhiAt(at + 10 * S)).toBe(0);
    // The way round is the short one: 270 degrees on is a pick that eases 90 forward.
    choose('offset', 12, at + 10 * S);
    const t = at + 10 * S + 22.5 * S;
    expect(phiAt(t) % 360).toBeCloseTo(270, 9);
    choose('both', 12, t);
    expect(shownPhiAt(t)).toBeCloseTo(phiAt(t) + (-90), 9);
    // A pick that changes nothing the viewer sees eases nothing; a hold in the mode the camera circles in keeps its angle.
    choose('both', 6, t + 10 * S);
    expect(shownPhiAt(t + 10 * S + 1)).toBeCloseTo(0, 6);
  });
});
