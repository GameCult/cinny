// The heading owner: the one place that knows where the view faces (`h`), where the camera stands on its circle against that (`phi`) and how far from the
// centre (`r`), at any clock. Module-level state, so a sky change that makes a new scene keeps the pose. Angles are unwrapped compass degrees between two
// `normalize` calls (the rig makes one before each stretch of motion); `ring.ts` is the one place that reasons about 0 / 360.
//
// The state is one SEGMENT: the pose at its start `t0`, the mode and bounded speed in force, and the ease that takes the pose to the one the inputs owe.
// `poseAt(t)` is a pure function of the segment and `t`, ease included. Every change of an input (a mode pick, a hold, the speed, the offset, a bound, reduced
// motion, a place) starts a new segment from `poseAt(now)`: no log of changes, no second copy of the ease, so whoever reads at any clock, a rebuilt scene
// included, gets the pose the view has.
//
// The camera sits on its circle at angle `h + phi` and distance `r` (signed, forward positive): with `phi` 0 it is pushed forward along its own heading
// (`view.ts` `cardPose`), and rotating the offset alone moves `phi` and leaves the view direction where it is (ruling ridge-scene-view-submenus). `phi` is 0
// whenever the view direction turns with the camera ('both'). The bound on `r` is the baker's (`view.ts` `offsetRange`, given by the scene as `setRange`): a
// forward offset past `rMaxM` fits only with the camera exactly on its heading. So an ease takes `phi` and `r` one after the other, STAGE_MS each, in the
// order that keeps every pose inside it from wherever it starts: a camera going to stand on its heading turns first and lets the offset out after; one going
// off it brings the offset in first and lets the camera go after.
import { bindOwner, getCamera, holdCamera, isHeld } from '../cameraState';

/** `still`: nothing turns. `offset`: the camera circles the centre, the view direction stays. `both`: the view direction turns and the camera with it. */
export type RotationMode = 'still' | 'offset' | 'both';

/** Where the view faces, where the camera stands on its circle against that, and its offset (m, signed): the pose the rig lays the cards out from. */
export interface Pose {
  h: number;
  phi: number;
  r: number;
}

/** What the baked place and the viewport allow: the speed (degrees per second, either way) a mode may turn at, and the offsets the camera may take at an angle in a mode. */
type Speed = (mode: RotationMode) => number;
type Range = (mode: RotationMode, phiDeg: number) => [number, number];

export const STAGE_MS = 300; // one stage of an ease, ms
const EPS = 1e-9; // a pose this close to the one owed is there: nothing eases

interface Segment extends Pose {
  /** The clock (ms) at which `h`, `phi` and `r` hold. */
  t0: number;
  /** Degrees per second of whatever turns, signed and bounded, and what that is: the view direction ('both'), the camera on its circle ('offset') or nothing. */
  rate: number;
  turns: 'h' | 'phi' | undefined;
  /** The camera's angle turns only from this clock (ms): after the offset has come in. */
  turnsFrom: number;
  /** The angle an ease takes `phi` to from `t0` (unwrapped, the nearest way round); undefined: `phi` is what `turns` makes it. */
  phiTo: number | undefined;
  /** The offset an ease takes `r` to, from `rAt`. */
  rTo: number;
  rAt: number;
  /** The clock (ms) at which everything eased is home. */
  endAt: number;
}

let seg: Segment | undefined;
let frozen = false;
let anchored: string | undefined;
let speed: Speed | undefined;
let range: Range | undefined;
const listeners = new Set<() => void>();

/** 0 at `at`, 1 at `at + STAGE_MS` (smoothstep): the one curve of the view's easing. */
const ease = (at: number, now: number): number => {
  const x = Math.min(1, Math.max(0, (now - at) / STAGE_MS));
  return x * x * (3 - 2 * x);
};
const free: [number, number] = [-Infinity, Infinity];
/** What each mode turns: the view direction, the camera on its circle, or nothing. */
const TURNS: Record<RotationMode, Segment['turns']> = { both: 'h', offset: 'phi', still: undefined };
const rangeOf = (mode: RotationMode, phi: number): [number, number] => range?.(mode, phi) ?? free;

function pose(s: Segment, t: number): Pose {
  const sec = (t - s.t0) / 1000;
  return {
    h: s.h + (s.turns === 'h' ? s.rate * sec : 0),
    phi:
      s.phiTo !== undefined
        ? s.phi + (s.phiTo - s.phi) * ease(s.t0, t)
        : s.phi + (s.turns === 'phi' ? (s.rate * Math.max(0, t - s.turnsFrom)) / 1000 : 0),
    r: s.r + (s.rTo - s.r) * ease(s.rAt, t),
  };
}

/**
 * Start a segment at `now` from `from`, the pose the view has there, under the inputs in force: the viewer's choice, the hold, reduced motion and the bounds.
 * What the inputs owe is where the camera must stand (on its heading when the view turns with it and is not held) and the offset the bound allows there; an
 * ease is what takes `from` to it, none when `snap` (a place or a bound met for the first time) or while frozen.
 */
function begin(now: number, from: Pose, snap = false): void {
  const cam = getCamera();
  const held = isHeld();
  const kin: RotationMode = frozen || held ? 'still' : cam.mode;
  const toHeading = cam.mode === 'both' && !held;
  const limit = speed?.(cam.mode) ?? Infinity;
  const phiTo = toHeading ? 360 * Math.round(from.phi / 360) : undefined;
  const landed = phiTo ?? from.phi;
  const [lo, hi] = rangeOf(cam.mode, landed); // the bound is the chosen mode's, held or frozen or not: a hold does not move the offset
  const rTo = Math.min(hi, Math.max(lo, cam.offsetM));
  const easing = !snap && !frozen;
  const turnsPhi = easing && phiTo !== undefined && Math.abs(phiTo - from.phi) > EPS;
  const movesR = easing && Math.abs(rTo - from.r) > EPS;
  // Going to circle with the offset out past the circle's bound: the camera stays on its heading until the offset is in.
  const [circleLo, circleHi] = rangeOf('offset', from.phi);
  const holdsPhi = movesR && kin === 'offset' && (from.r < circleLo || from.r > circleHi);
  const rAt = turnsPhi ? now + STAGE_MS : now;
  seg = {
    t0: now,
    h: from.h,
    phi: turnsPhi ? from.phi : landed,
    r: movesR ? from.r : rTo,
    rate: Math.sign(cam.speedDegPerS) * Math.min(Math.abs(cam.speedDegPerS), limit),
    turns: TURNS[kin],
    turnsFrom: holdsPhi ? now + STAGE_MS : now,
    phiTo: turnsPhi ? phiTo : undefined,
    rTo,
    rAt,
    endAt: Math.max(turnsPhi ? now + STAGE_MS : now, movesR ? rAt + STAGE_MS : now),
  };
}

const current = (now: number): Segment => {
  if (!seg) begin(now, { h: 0, phi: 0, r: 0 }, true);
  return seg as Segment;
};
/** The pose at `now` (ms): unwrapped degrees, bounded by the last `normalize` and the stretch since. */
export function poseAt(now: number): Pose {
  return pose(current(now), now);
}
const emit = () => [...listeners].forEach((cb) => cb());
/** A new segment at `now` from the pose the view has, told to the subscribers. */
function restart(now: number, over: Partial<Pose> = {}, snap = false): void {
  begin(now, { ...poseAt(now), ...over }, snap);
  emit();
}

/** The clock (ms) at which what the last change eased is home. */
export const settledAt = (): number => seg?.endAt ?? 0;

// The viewer's choice or hold changed: a new segment at that clock, before any listener hears of it.
bindOwner((at) => restart(Math.max(at, seg?.t0 ?? at)));

/**
 * Bound the speed in each mode to what the baked place sustains (`view.ts` `maxSpeed`), from this moment, before anything awaits the place's tiles, and point
 * the view at a place: a place not shown before faces its rest azimuth, the camera on its heading, with no ease; the same place again keeps the pose.
 */
export function anchor(key: string, restDeg: number, now: number, limit?: Speed): void {
  if (limit) speed = limit;
  if (anchored === key) {
    if (limit) restart(now);
    return;
  }
  anchored = key;
  range = undefined; // the bound belongs to the place before
  restart(now, { h: restDeg, phi: 0 }, true);
}

/** The offsets the scene's place and viewport allow (`view.ts` `offsetRange`); the first one met takes the offset to its bound at once, a new one eases there. */
export function setRange(limit: Range, now: number): void {
  const first = range === undefined;
  range = limit;
  restart(now, {}, first);
}

/**
 * A manual turn: the view direction becomes `h` now, in every mode, and the rotation stops where the viewer left it (ruling ridge-view-turn-handback): the view
 * is held in cameraState, which leaves the chosen mode as it is; a rebuild keeps the hold, and picking a mode, the one already chosen included, resumes it.
 */
export function hold(h: number, now: number): void {
  begin(now, { ...poseAt(now), h });
  if (isHeld()) emit();
  else holdCamera(now); // the owner starts the held segment, then the camera's listeners hear it, once
}

/** Nothing turns while `on` (reduced motion), whatever the viewer chose; the view takes the pose owed at once and stays there. */
export function freeze(on: boolean, now: number): void {
  if (on === frozen) return;
  frozen = on;
  restart(now);
}

/** Bring `h` and `phi` into [0, 360) at `now`, so the transforms stay small however long the page has been open: the whole turns are all that goes, and the ease and the motion go on. Silent: the caller lays out again. */
export function normalize(now: number): void {
  const s = current(now);
  const p = pose(s, now);
  const dh = 360 * Math.floor(p.h / 360);
  const dphi = 360 * Math.floor(p.phi / 360);
  s.h -= dh;
  s.phi -= dphi;
  if (s.phiTo !== undefined) s.phiTo -= dphi;
}

/** Hear every change of the pose's course: the viewer's choice or hold, a bound, reduced motion, a manual turn, a new place; returns the way to stop. */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** For tests: the state of a fresh page. */
export function resetHeading(): void {
  seg = undefined;
  frozen = false;
  anchored = undefined;
  speed = undefined;
  range = undefined;
  listeners.clear();
}
