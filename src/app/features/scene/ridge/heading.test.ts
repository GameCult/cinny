import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchor, freeze, hold, normalize, poseAt, resetHeading, setRange, settledAt, STAGE_MS, subscribe } from './heading';
import type { RotationMode } from './heading';
import * as camera from '../cameraState';
import { effectiveMode, getCamera, isHeld, resetCamera, setCamera, subscribe as onCamera } from '../cameraState';
import { maxSpeed } from './view';
import { norm } from './ring';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';

const S = 1000;

/** The viewer's choice, at the clock `at` (ms): the one way the mode and the speed reach the view. */
const choose = (mode: RotationMode, speedDegPerS: number, at: number) => setCamera({ mode, speedDegPerS }, at);

/** The bound of a baked place, as `view.ts` `offsetRange` draws it: 100 m round the circle, 200 m forward with the camera exactly on its heading and the view turning with it. */
const BACK = 100;
const FORWARD = 200;
const range = (mode: RotationMode, phi: number): [number, number] => [-BACK, mode !== 'offset' && Math.abs(norm(phi + 180) - 180) < 1e-6 ? FORWARD : BACK];
/** Whether a pose is one the bound allows, whatever mode led there. */
const fits = (p: { phi: number; r: number }): boolean => p.r >= range('both', p.phi)[0] - 1e-9 && p.r <= range('both', p.phi)[1] + 1e-9;

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  resetCamera();
  resetHeading();
  setCamera({ mode: 'still', speedDegPerS: 0, offsetM: 0 }, 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the heading owner', () => {
  it('faces nothing in particular until a place anchors it, and turns nothing while the viewer chose nothing to turn', () => {
    expect(poseAt(5 * S)).toEqual({ h: 0, phi: 0, r: 0 });
  });

  it('anchors a place at its rest azimuth once, and a later anchor of the same place changes nothing', () => {
    anchor('vienna', 214, 0);
    expect(poseAt(0).h).toBe(214);
    choose('both', 0.6, 0);
    expect(poseAt(10 * S).h).toBeCloseTo(220, 9);
    anchor('vienna', 214, 10 * S); // a rebuild for a new sky: the view keeps the direction it has turned to
    expect(poseAt(10 * S).h).toBeCloseTo(220, 9);
    anchor('fuji', 100, 10 * S); // another place faces its own rest azimuth, with the camera on its heading
    expect(poseAt(10 * S)).toMatchObject({ h: 100, phi: 0 });
  });

  it('is unwrapped over several revolutions between normalizations: nothing wraps or clamps it', () => {
    anchor('p', 0, 0);
    choose('both', 6, 0);
    expect(poseAt(60 * S).h).toBeCloseTo(360, 9);
    expect(poseAt(210 * S).h).toBeCloseTo(1260, 9);
    choose('both', -6, 210 * S);
    expect(poseAt(330 * S).h).toBeCloseTo(540, 9);
    expect(poseAt(500 * S).h).toBeLessThan(0);
  });

  it('turns the view direction in both mode, the camera on its circle alone in offset mode, and nothing when still', () => {
    anchor('p', 100, 0);
    choose('both', 2, 0);
    expect(poseAt(10 * S)).toMatchObject({ h: 120, phi: 0 });
    choose('offset', 2, 10 * S); // nothing jumps at the change
    expect(poseAt(10 * S)).toMatchObject({ h: 120, phi: 0 });
    expect(poseAt(20 * S)).toMatchObject({ h: 120, phi: 20 });
    choose('still', 2, 20 * S);
    expect(poseAt(99 * S)).toMatchObject({ h: 120, phi: 20 });
    choose('offset', 2, 99 * S); // the camera keeps the angle it stopped at, and goes on from there
    expect(poseAt(104 * S)).toMatchObject({ h: 120, phi: 30 });
  });

  it('puts the camera back on its heading when the view direction is made to turn with it, by the short way round, and the view direction turns meanwhile', () => {
    anchor('p', 100, 0);
    choose('offset', 12, 0);
    expect(poseAt(7.5 * S).phi).toBeCloseTo(90, 9);
    choose('both', 12, 7.5 * S);
    expect(poseAt(7.5 * S)).toMatchObject({ h: 100 }); // the pick moves nothing in the frame it is made
    const gone = [0, 0.25, 0.5, 0.75, 1].map((x) => poseAt(7.5 * S + x * STAGE_MS).phi);
    gone.slice(1).forEach((v, i) => expect(v).toBeLessThan(gone[i]));
    expect(gone[4]).toBe(0);
    expect(poseAt(7.5 * S + 5 * S).phi).toBe(0);
    expect(poseAt(7.5 * S + 5 * S).h).toBeCloseTo(100 + 12 * 5, 9);
    // 270 degrees on is 90 short of home the other way: the camera goes forward to 360, not back through 270.
    choose('offset', 12, 20 * S);
    choose('offset', 12, 20 * S + 22.5 * S);
    const t = 20 * S + 22.5 * S;
    expect(norm(poseAt(t).phi)).toBeCloseTo(270, 9);
    choose('both', 12, t);
    const mid = poseAt(t + STAGE_MS / 2).phi;
    expect(norm(mid)).toBeGreaterThan(270);
    expect(norm(poseAt(t + STAGE_MS).phi)).toBeCloseTo(0, 9);
  });

  it('a speed change takes effect from now, without moving the view', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    choose('both', 3, 10 * S);
    expect(poseAt(10 * S).h).toBe(10);
    expect(poseAt(20 * S).h).toBe(40);
  });

  it('a manual turn sets the view direction in every mode and stops the rotation: the hold is the one fact, the chosen mode is left alone', () => {
    for (const mode of ['still', 'offset', 'both'] as const) {
      resetHeading();
      anchor('p', 0, 0);
      choose(mode, 1, 0);
      hold(300, 10 * S);
      expect(poseAt(10 * S).h).toBe(300);
      expect(getCamera().mode).toBe(mode);
      expect(effectiveMode()).toBe('still');
      expect(poseAt(500 * S).h).toBe(300);
      expect(poseAt(500 * S).phi).toBe(poseAt(10 * S).phi);
      choose('both', 1, 500 * S); // a rotation mode chosen again resumes it
      expect(poseAt(510 * S).h).toBe(310);
    }
  });

  it('a hold outlives a rebuild and not a reload: a reload is a Return, and rotation resumes in the chosen mode', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    hold(100, 10 * S);
    anchor('p', 0, 20 * S); // what every scene build does
    expect(poseAt(60 * S).h).toBe(100);
    expect(isHeld()).toBe(true);
    const stored = getCamera();
    expect(stored.mode).toBe('both'); // what is stored is what the viewer chose
    resetCamera(); // a reload reads the stored choice
    expect(getCamera()).toEqual(stored);
    expect(isHeld()).toBe(false);
    expect(effectiveMode()).toBe('both');
    resetHeading();
    anchor('p', 0, 100 * S); // the new page faces its rest azimuth and turns
    expect(poseAt(110 * S).h).toBe(10);
  });

  it('bounds the speed for the mode and the place and never rewrites the stored one: switching to a mode with room restores it', () => {
    const ring = parseManifest(wireManifest({}, 3, 32), '/d/');
    const slow = maxSpeed(ring, 'both');
    anchor('p', 0, 0, (m) => maxSpeed(ring, m));
    choose('both', 50, 0);
    expect(poseAt(10 * S).h).toBeCloseTo(10 * slow, 9);
    expect(getCamera().speedDegPerS).toBe(50); // the viewer's value
    choose('offset', 50, 10 * S);
    expect(poseAt(11 * S).phi).toBeCloseTo(12, 9); // the ceiling of that mode, not the turning mode's bound
    choose('both', 50, 11 * S);
    expect(poseAt(21 * S).h - poseAt(11 * S).h).toBeCloseTo(10 * slow, 9);
    expect(getCamera().speedDegPerS).toBe(50);
    setCamera({ speedDegPerS: -50 }, 21 * S);
    expect(poseAt(31 * S).h - poseAt(21 * S).h).toBeCloseTo(-10 * slow, 9);
  });

  it('bounds the speed from the anchor, before anything has been told the place is loaded: a stored speed above the bound does not run over the load', () => {
    const ring = parseManifest(wireManifest({}, 3, 32), '/d/');
    const slow = maxSpeed(ring, 'both');
    setCamera({ mode: 'both', speedDegPerS: 12 }, 0);
    anchor('p', 214, 0, (m) => maxSpeed(ring, m)); // what a scene start does, then awaits the first tiles
    expect(poseAt(5 * S).h).toBeCloseTo(214 + 5 * slow, 9);
    expect(slow).toBeLessThan(12);
    anchor('p', 214, 5 * S, (m) => maxSpeed(ring, m)); // a rebuild keeps the heading and the bound
    expect(poseAt(10 * S).h).toBeCloseTo(214 + 10 * slow, 9);
  });

  it('choosing the mode the viewer had before a hold resumes the view: the mode they had is not still any more, so the choice is a change', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    hold(100, 10 * S);
    setCamera({ mode: 'both' }, 20 * S);
    expect(poseAt(30 * S).h).toBe(110);
    expect(getCamera().mode).toBe('both');
  });

  it('keeps the pose when the scene is rebuilt: the module outlives it', () => {
    anchor('p', 50, 0);
    choose('both', 1, 0);
    expect(poseAt(30 * S).h).toBe(80);
    anchor('p', 50, 30 * S);
    expect(poseAt(30 * S).h).toBe(80);
  });

  it('freezes under reduced motion without moving the view, and goes on from where it stopped', () => {
    anchor('p', 0, 0);
    choose('both', 1, 0);
    freeze(true, 10 * S);
    expect(poseAt(10 * S).h).toBe(10);
    expect(poseAt(50 * S).h).toBe(10);
    expect(getCamera().mode).toBe('both'); // the viewer's choice is untouched
    freeze(false, 50 * S);
    expect(poseAt(60 * S).h).toBe(20);
  });

  it('normalizes into [0, 360) without changing the view, so the angles never grow with uptime, and an ease under way goes on as it was', () => {
    anchor('p', 0, 0);
    choose('both', 6, 0);
    const day = 24 * 3600 * S;
    normalize(day);
    const h = poseAt(day).h;
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(h).toBeCloseTo((6 * 86400) % 360, 6);
    expect(poseAt(day + 30 * S).h).toBeCloseTo(h + 180, 6);
    choose('offset', 6, day + 30 * S);
    normalize(day + 100 * S);
    expect(poseAt(day + 100 * S).phi).toBeGreaterThanOrEqual(0);
    expect(poseAt(day + 100 * S).phi).toBeLessThan(360);
    setCamera({ speedDegPerS: -6 }, day + 100 * S);
    normalize(day + 101 * S);
    expect(poseAt(day + 101 * S).phi).toBeGreaterThanOrEqual(0); // a turn the other way is brought into range too
    // An ease is the same ease before and after it is renormalized, in the middle.
    choose('offset', 12, day + 200 * S);
    choose('both', 12, day + 207.5 * S);
    const at = day + 207.5 * S;
    const before = [0.2, 0.5, 0.9].map((x) => poseAt(at + x * STAGE_MS));
    normalize(at + 0.3 * STAGE_MS);
    const after = [0.2, 0.5, 0.9].map((x) => poseAt(at + x * STAGE_MS));
    after.forEach((p, i) => {
      expect(norm(p.phi)).toBeCloseTo(norm(before[i].phi), 6);
      expect(norm(p.h)).toBeCloseTo(norm(before[i].h), 6);
      expect(p.r).toBeCloseTo(before[i].r, 9);
    });
  });

  it('tells subscribers of every change of its course: a choice, a hold, a bound, a manual turn while held, a new place; and of nothing that changes nothing', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    anchor('p', 0, 0);
    expect(cb).toHaveBeenCalledTimes(1);
    anchor('p', 0, 1); // the same place, no new bound: nothing
    expect(cb).toHaveBeenCalledTimes(1);
    setCamera({ mode: 'both', speedDegPerS: 1 }, 2);
    expect(cb).toHaveBeenCalledTimes(2);
    setCamera({ mode: 'both', speedDegPerS: 1 }, 3); // nothing changed
    expect(cb).toHaveBeenCalledTimes(2);
    hold(5, 4); // takes the hold: told once
    expect(cb).toHaveBeenCalledTimes(3);
    hold(6, 5); // turned again by hand while held: told
    expect(cb).toHaveBeenCalledTimes(4);
    setRange(range, 6);
    expect(cb).toHaveBeenCalledTimes(5);
    off();
    anchor('q', 0, 7);
    expect(cb).toHaveBeenCalledTimes(5);
  });

  it('is the one owner of the order: the heading is current when a listener of the camera hears of a change, whenever the listener registered', () => {
    setCamera({ mode: 'both', speedDegPerS: 1 }, 0);
    const early: number[] = [];
    const offEarly = onCamera((_n, _p, at) => early.push(poseAt(at).h)); // before the place is anchored: first of the listeners, as a control mounted before the scene start is
    anchor('p', 214, 0);
    const late: number[] = [];
    const offLate = onCamera((_n, _p, at) => late.push(poseAt(at).h));
    anchor('p', 214, 1 * S); // a rebuild for a sky anchors the same place again
    setCamera({ speedDegPerS: 4 }, 5 * S);
    expect(poseAt(10 * S).h).toBeCloseTo(214 + 5 + 20, 9);
    setCamera({ mode: 'still' }, 11 * S);
    expect(early).toEqual(late);
    expect(early[0]).toBeCloseTo(214 + 5, 9); // the heading at the change, with the speed it had until it
    expect(early[1]).toBeCloseTo(214 + 5 + 24, 9);
    offEarly();
    offLate();
  });

  it('keeps no log of the camera: the owner takes each change as it is made, so a change nobody reads is held nowhere', () => {
    expect(Object.keys(camera)).not.toContain('takeChanges');
    anchor('p', 100, 0);
    choose('both', 2, 0);
    choose('both', 4, 3 * S); // 6 degrees by then
    choose('offset', 4, 5 * S); // 14 degrees: the view stops, the camera starts
    choose('both', 1, 7 * S); // the camera went 8 degrees round, and is put back on its heading
    expect(poseAt(9 * S).h).toBeCloseTo(100 + 14 + 2, 9);
  });

  describe('a change of mode eases the pose in two stages inside the bound, from wherever the pose is', () => {
    const sample = (from: number, to: number, step = 1): { h: number; phi: number; r: number }[] => {
      const out = [];
      for (let t = from; t <= to; t += step) out.push(poseAt(t));
      return out;
    };
    /** Every pose inside the bound, and whenever the camera angle moves the offset is inside the circle's bound at both ends of the move. */
    const insideTheBound = (poses: { phi: number; r: number }[]) => {
      poses.forEach((p, i) => {
        expect(fits(p), `pose ${i}: phi ${p.phi}, r ${p.r}`).toBe(true);
        if (i && Math.abs(p.phi - poses[i - 1].phi) > 1e-9) {
          expect(Math.abs(p.r)).toBeLessThanOrEqual(BACK + 0.02); // a sample step may straddle the end of a stage: a thousandth of the ease on
          expect(Math.abs(poses[i - 1].r)).toBeLessThanOrEqual(BACK + 0.02);
        }
      });
    };

    /** The clock at which the camera has gone a quarter round its circle at 12 degrees a second, started when its offset is in: the offset comes in first, and the angle is let go after. */
    const QUARTER = 90 / 12 * S + STAGE_MS;

    beforeEach(() => {
      setCamera({ offsetM: 200 }, 0);
      anchor('p', 100, 0);
      setRange(range, 0);
    });

    it('goes to a mode that stands the camera on its heading in two stages: the angle first, the offset let out after, and the view direction never waits', () => {
      choose('offset', 12, 0);
      const at = QUARTER;
      expect(poseAt(at)).toMatchObject({ phi: 90, r: BACK });
      choose('both', 12, at);
      expect(poseAt(at)).toMatchObject({ h: 100, phi: 90, r: BACK }); // what is seen at the pick
      expect(settledAt()).toBe(at + 2 * STAGE_MS);
      const stage1 = sample(at, at + STAGE_MS);
      expect(stage1.every((p) => p.r === BACK)).toBe(true); // the angle alone
      expect(stage1.at(-1)!.phi).toBeCloseTo(0, 9);
      const stage2 = sample(at + STAGE_MS, at + 2 * STAGE_MS);
      expect(stage2.every((p) => p.phi === 0)).toBe(true); // the offset alone
      expect(stage2.at(-1)!.r).toBe(FORWARD);
      expect(poseAt(at + 10 * S)).toMatchObject({ phi: 0, r: FORWARD });
      expect(poseAt(at + 3 * S).h).toBeCloseTo(100 + 36, 9); // turning from the instant of the pick
      insideTheBound(sample(at, at + 2 * STAGE_MS));
    });

    it('goes to a mode that takes the camera off its heading the other way: the offset comes in first with the camera held where it stood, then the camera goes', () => {
      choose('both', 12, 0);
      const at = 10 * S;
      expect(poseAt(at)).toMatchObject({ phi: 0, r: FORWARD });
      choose('offset', 12, at);
      const stage1 = sample(at, at + STAGE_MS);
      expect(stage1.every((p) => p.phi === 0)).toBe(true);
      expect(stage1.at(-1)!.r).toBe(BACK);
      expect(poseAt(at + STAGE_MS + 1 * S)).toMatchObject({ r: BACK });
      expect(poseAt(at + STAGE_MS + 1 * S).phi).toBeCloseTo(12, 9); // and goes round from the angle it stood at, at the speed
      insideTheBound(sample(at, at + 3 * STAGE_MS));
    });

    it('a pick that asks nothing of the offset does not wait for it: the angle goes at once', () => {
      choose('both', 12, 0);
      setCamera({ offsetM: 50 }, 1 * S);
      choose('offset', 12, 2 * S);
      expect(poseAt(2 * S + 1 * S).phi).toBeCloseTo(12, 9);
    });

    it('a pick made while an ease is under way starts from the pose the view has, and every pose on the way stays inside the bound', () => {
      const picks: RotationMode[] = ['still', 'offset', 'both'];
      let checked = 0;
      for (const first of picks) {
        for (const second of picks) {
          for (const gap of [10, 100, 250, 310, 450, 590]) {
            resetHeading();
            resetCamera();
            setCamera({ mode: 'offset', speedDegPerS: 12, offsetM: 200 }, 0);
            anchor('p', 100, 0);
            setRange(range, 0);
            const at = QUARTER;
            setCamera({ mode: first }, at);
            const seen = poseAt(at + gap);
            setCamera({ mode: second }, at + gap);
            expect(poseAt(at + gap), `${first} then ${second} after ${gap} ms`).toEqual(seen); // nothing moves at the pick
            insideTheBound(sample(at, at + 4 * STAGE_MS, 3));
            checked += 1;
          }
        }
      }
      expect(checked).toBe(54);
    });

    it('a pick to both made from the offset-only mode mid-way, then to offset-only again, never leaves the bound: the case a target-only order got wrong', () => {
      choose('offset', 12, 0);
      const at = QUARTER;
      choose('both', 12, at); // the angle goes first, the offset held at the circle's bound
      choose('offset', 12, at + 100); // and the offset-only mode has the offset on the circle's bound already
      insideTheBound(sample(at, at + 4 * STAGE_MS, 2));
      // From both with the offset out, pick still then both then offset within a stage each.
      resetHeading();
      resetCamera();
      setCamera({ mode: 'both', speedDegPerS: 12, offsetM: 200 }, 0);
      anchor('p', 100, 0);
      setRange(range, 0);
      choose('offset', 12, 5 * S); // the offset comes in first
      choose('both', 12, 5 * S + 100); // back out: the camera is still on its heading, so the offset can go straight out
      insideTheBound(sample(5 * S, 5 * S + 4 * STAGE_MS, 2));
      expect(poseAt(5 * S + 10 * S)).toMatchObject({ phi: 0, r: FORWARD });
    });

    it('a slider eases in one stage, inside the bound the mode keeps, and an offset past it is held to it', () => {
      choose('both', 0.6, 0);
      setCamera({ offsetM: 20 }, 1 * S);
      expect(poseAt(1 * S).r).toBe(FORWARD);
      expect(poseAt(1 * S + STAGE_MS).r).toBe(20);
      expect(settledAt()).toBe(1 * S + STAGE_MS);
      setCamera({ offsetM: 999 }, 5 * S);
      expect(poseAt(6 * S).r).toBe(FORWARD);
      choose('offset', 0.6, 7 * S);
      expect(poseAt(9 * S).r).toBe(BACK); // the viewer's 999 is not rewritten
      expect(getCamera().offsetM).toBe(999);
      choose('both', 0.6, 10 * S);
      expect(poseAt(12 * S).r).toBe(FORWARD);
    });

    it('a new bound is a new segment from the pose the view has: a rebuild mid-ease lands exactly where the old scene was', () => {
      choose('offset', 12, 0);
      const at = QUARTER;
      choose('both', 12, at);
      for (const gap of [50, 150, 299, 301, 450]) {
        const seen = poseAt(at + gap);
        setRange(range, at + gap); // what a rebuild at another size, or a rebuilt scene, does
        const now = poseAt(at + gap);
        expect(now.h).toBeCloseTo(seen.h, 9);
        expect(now.phi).toBeCloseTo(seen.phi, 9);
        expect(now.r).toBeCloseTo(seen.r, 9);
      }
      insideTheBound(sample(at, at + 4 * STAGE_MS, 2));
      expect(poseAt(at + 5 * S)).toMatchObject({ phi: 0, r: FORWARD });
    });

    it('has no ease under reduced motion: the pose owed is the pose shown at once, and one begun before is cut short', () => {
      choose('offset', 12, 0);
      const at = QUARTER;
      choose('both', 12, at);
      expect(settledAt()).toBeGreaterThan(at);
      freeze(true, at + 10);
      expect(poseAt(at + 10)).toMatchObject({ phi: 0, r: FORWARD });
      expect(poseAt(at + 5 * S).h).toBe(poseAt(at + 10).h); // and nothing turns
      setCamera({ mode: 'offset', speedDegPerS: 12 }, at + 20);
      expect(poseAt(at + 21)).toMatchObject({ r: BACK }); // the clamp, at once
      setCamera({ mode: 'both', speedDegPerS: 12 }, at + 30);
      expect(poseAt(at + 31)).toMatchObject({ phi: 0, r: FORWARD });
      expect(settledAt()).toBeLessThanOrEqual(at + 30);
    });
  });
});
