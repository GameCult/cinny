import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anchor, getMode, headingAt, hold, phiAt, resetHeading, setMode, setRate, subscribe } from './heading';

const S = 1000;

beforeEach(resetHeading);

describe('the heading owner', () => {
  it('starts still, facing nothing in particular until a place anchors it', () => {
    expect(getMode()).toBe('still');
    expect(headingAt(5 * S)).toBe(0);
    expect(phiAt(5 * S)).toBe(0);
  });

  it('anchors a place at its rest azimuth once, and a later anchor of the same place changes nothing', () => {
    anchor('vienna', 214, 0);
    expect(headingAt(0)).toBe(214);
    setMode('both', 0);
    setRate(0.6, 0);
    expect(headingAt(10 * S)).toBeCloseTo(220, 9);
    anchor('vienna', 214, 10 * S); // a rebuild for a new sky: the view keeps the direction it has turned to
    expect(headingAt(10 * S)).toBeCloseTo(220, 9);
    anchor('fuji', 100, 10 * S); // another place faces its own rest azimuth, with the camera on its heading
    expect(headingAt(10 * S)).toBe(100);
    expect(phiAt(10 * S)).toBe(0);
  });

  it('is unwrapped over several revolutions: nothing wraps or clamps it', () => {
    anchor('p', 0, 0);
    setMode('both', 0);
    setRate(6, 0);
    expect(headingAt(60 * S)).toBeCloseTo(360, 9);
    expect(headingAt(210 * S)).toBeCloseTo(1260, 9);
    setRate(-6, 210 * S);
    expect(headingAt(330 * S)).toBeCloseTo(540, 9);
    expect(headingAt(500 * S)).toBeLessThan(0);
  });

  it('turns the view direction in both mode, the camera on its circle alone in offset mode, and nothing when still', () => {
    anchor('p', 100, 0);
    setRate(2, 0);
    setMode('both', 0);
    expect([headingAt(10 * S), phiAt(10 * S)]).toEqual([120, 0]);
    setMode('offset', 10 * S); // nothing jumps at the change
    expect([headingAt(10 * S), phiAt(10 * S)]).toEqual([120, 0]);
    expect([headingAt(20 * S), phiAt(20 * S)]).toEqual([120, 20]);
    setMode('still', 20 * S);
    expect([headingAt(99 * S), phiAt(99 * S)]).toEqual([120, 20]);
    setMode('both', 99 * S); // the camera keeps the angle it stopped at
    expect([headingAt(104 * S), phiAt(104 * S)]).toEqual([130, 20]);
  });

  it('a rate change takes effect from now, without moving the view', () => {
    anchor('p', 0, 0);
    setMode('both', 0);
    setRate(1, 0);
    setRate(3, 10 * S);
    expect(headingAt(10 * S)).toBe(10);
    expect(headingAt(20 * S)).toBe(40);
  });

  it('a manual turn sets the view direction in every mode, and stops the rotation where the viewer left it', () => {
    for (const mode of ['still', 'offset', 'both'] as const) {
      resetHeading();
      anchor('p', 0, 0);
      setRate(1, 0);
      setMode(mode, 0);
      hold(300, 10 * S);
      expect(headingAt(10 * S)).toBe(300);
      expect(getMode()).toBe('still');
      expect(headingAt(500 * S)).toBe(300);
      expect(phiAt(500 * S)).toBe(phiAt(10 * S));
      setMode('both', 500 * S); // a rotation mode chosen again resumes it
      expect(headingAt(510 * S)).toBe(310);
    }
  });

  it('keeps the heading when the scene is rebuilt: the module outlives it', () => {
    anchor('p', 50, 0);
    setMode('both', 0);
    setRate(1, 0);
    // A rebuild is another scene reading the same module state: nothing here is per scene.
    expect(headingAt(30 * S)).toBe(80);
    anchor('p', 50, 30 * S);
    expect(headingAt(30 * S)).toBe(80);
  });

  it('tells subscribers of every change and no change that changes nothing', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    anchor('p', 0, 0);
    expect(cb).toHaveBeenCalledTimes(1);
    anchor('p', 0, 1);
    setMode('still', 1);
    setRate(0, 1);
    expect(cb).toHaveBeenCalledTimes(1);
    setMode('both', 1);
    setRate(1, 1);
    hold(5, 2);
    expect(cb).toHaveBeenCalledTimes(4);
    off();
    setRate(2, 3);
    expect(cb).toHaveBeenCalledTimes(4);
  });
});
