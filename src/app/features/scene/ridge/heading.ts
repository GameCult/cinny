// The heading owner: which way the view faces (`h`) and where the camera stands on its circle against that (`phi`), as kinematics over a clock.
// Module-level state so it outlives scene rebuilds: a sky change makes a new scene and the view keeps its direction. Angles are unwrapped compass
// degrees between two `normalize` calls (the rig makes one before each stretch of motion, so they never grow with uptime); `ring.ts` is the one place
// that reasons about 0 / 360. Nothing but this module advances `h` or `phi`.
//
// The rotation mode, its speed and the hold are not held here: they are the viewer's choice and the session's hold, `cameraState.ts`, the one owner. This
// module keeps only where the view and the camera were at the clock `t0` and integrates them under the mode in effect since (the chosen mode, 'still' while
// held), with the speed bounded to what the baked place sustains in that mode (`setSpeedLimit`, derived at every read, never stored). It does not listen:
// every read takes the changes the viewer made since the last one from `cameraState` (`takeChanges`) and folds them in, each at its own moment, before it answers,
// so the heading is a function of the clock and of those changes whoever else listens to the camera and in whatever order. A rebuild keeps the hold; a reload
// (a Return) does not.
//
// The camera sits on its circle at angle `theta = h + phi`: with `phi` 0 it is pushed forward along its own heading (`view.ts` `cardPose`); rotating
// the offset alone moves `phi` and leaves the view direction where it is (ruling ridge-scene-view-submenus). `phi` is 0 whenever the view direction turns
// with the camera ('both'): picking that mode returns the camera to its heading. A change of mode eases the view over two stages of STAGE_MS, the camera's
// angle and its offset one after the other, never together (the fit of a card's linear slide holds along the angle at a fixed offset, and along the offset at
// the angle the mode keeps; blended, they leave it): `phiAt` is where the camera is going, `shownPhiAt` the angle the viewer sees while it gets there (the one
// the rig poses the cards from), and `offsetFreeAt` the moment the offset may start. A pick that stands the camera on its heading turns it first and lets
// the offset out after; a pick that takes it off the heading brings the offset in first and lets the camera go after.
import { getCamera, holdCamera, isHeld, takeChanges } from '../cameraState';
import type { CameraChange, CameraChoice } from '../cameraState';

/** `still`: nothing turns. `offset`: the camera circles the centre, the view direction stays. `both`: the view direction turns and the camera with it. */
export type RotationMode = 'still' | 'offset' | 'both';

interface State {
  h0: number;
  phi0: number;
  /** The clock (ms) at which `h0` and `phi0` held. */
  t0: number;
  /** What the heading was last anchored to: a baked place (its bake id), so a place change restarts at its rest azimuth and a sky change does not. */
  anchor: string | undefined;
  /**
   * The ease a change of mode began at `at` (ms): the angle the viewer saw then, `from` (unwrapped, within half a turn of where the camera was going), and
   * whether the angle goes in the first stage (the camera is going to stand on its heading) or the second. The kinematics never read it.
   */
  ease: { from: number; at: number; phiFirst: boolean } | undefined;
  /** Nothing turns, whatever the viewer chose (the OS asks for reduced motion): an override of the environment, not a second copy of the choice. There is no ease then: the pose asked for is shown at once. */
  frozen: boolean;
}

const initial = (): State => ({ h0: 0, phi0: 0, t0: 0, anchor: undefined, ease: undefined, frozen: false });

/** How long one stage of the ease takes, ms, and the whole of it: the angle and the offset a stage each. */
export const STAGE_MS = 300;
export const EASE_MS = 2 * STAGE_MS;
/** What is left of a stage that began at `at` (ms), from 1 down to 0 at `at + STAGE_MS` (smoothstep): the one curve of the view's easing, the rig's offset included. */
export const easeLeft = (at: number, now: number): number => {
  const x = Math.min(1, Math.max(0, (now - at) / STAGE_MS));
  return 1 - x * x * (3 - 2 * x);
};
let state = initial();
const listeners = new Set<() => void>();

/** The largest speed a mode may turn at here: the baked place's bound (`view.ts` `maxSpeed`), set by the scene that knows the place; none until then. */
type SpeedLimit = (mode: RotationMode) => number;
let speedLimit: SpeedLimit | undefined;
/** The mode in effect under a choice and a hold. */
const turning = (cam: CameraChoice, held: boolean, frozen: boolean): RotationMode => (frozen || held ? 'still' : cam.mode);
/** The speed the choice turns at, bounded for its mode at read: the stored value is the viewer's and is not rewritten. */
const speedOf = (cam: CameraChoice): number => {
  const limit = speedLimit?.(cam.mode) ?? Infinity;
  return Math.sign(cam.speedDegPerS) * Math.min(Math.abs(cam.speedDegPerS), limit);
};
const advanced = (now: number, cam: CameraChoice): number => (speedOf(cam) * (now - state.t0)) / 1000;
const headingUnder = (now: number, cam: CameraChoice, held: boolean): number =>
  state.h0 + (turning(cam, held, state.frozen) === 'both' ? advanced(now, cam) : 0);
const phiUnder = (now: number, cam: CameraChoice, held: boolean): number =>
  state.phi0 + (turning(cam, held, state.frozen) === 'offset' ? advanced(now, cam) : 0);
/** The angle shown at `now` under a choice: from the angle the viewer saw at the pick to where the camera is going by then, in the stage the ease gives the angle. */
const shownUnder = (now: number, cam: CameraChoice, held: boolean): number => {
  const phi = phiUnder(now, cam, held);
  const e = state.ease;
  if (!e) return phi;
  const left = easeLeft(e.phiFirst ? e.at : e.at + STAGE_MS, now);
  return e.from + (phi - e.from) * (1 - left);
};

const emit = () => [...listeners].forEach((cb) => cb());

/** Take `h`, `phi` and the clock to `now` under the choice `cam` in force until now: the one way a value is replaced, so no change makes the view jump. */
function settle(now: number, cam: CameraChoice, held: boolean, over: Partial<State> = {}, h = headingUnder(now, cam, held), phi = phiUnder(now, cam, held)): void {
  state = { ...state, ...over, h0: h, phi0: phi, t0: now };
}

/**
 * A change of the viewer's choice lands on the anchor at the moment it is made, under the choice and hold in force until it. Picking 'both' puts the camera on
 * its heading; a change of mode or of the hold begins an ease from the angle the viewer saw (by the shortest way round), none under reduced motion.
 */
function apply({ next, prev, at, wasHeld, held }: CameraChange): void {
  const shown = shownUnder(at, prev, wasHeld);
  const onHeading = next.mode === 'both' && !held;
  settle(at, prev, wasHeld, {}, headingUnder(at, prev, wasHeld), onHeading ? 0 : phiUnder(at, prev, wasHeld));
  if (next.mode === prev.mode && held === wasHeld) return; // a speed: the angle and the ease, if one is under way, go on
  const gap = shown - state.phi0;
  const from = state.phi0 + gap - 360 * Math.round(gap / 360);
  state = { ...state, ease: state.frozen ? undefined : { from, at, phiFirst: onHeading } };
}

/** Fold in what the viewer changed since the last read, each at its own moment: every read answers from the choices in force, whatever listened to them first. */
function catchUp(): void {
  takeChanges().forEach(apply);
}

/** The view direction at `now` (ms): unwrapped degrees, bounded by the last `normalize` and the stretch since. */
export function headingAt(now: number): number {
  catchUp();
  return headingUnder(now, getCamera(), isHeld());
}
/** The camera's angle on its circle against the heading at `now`, degrees, as `headingAt`: where it is going, which the offset's clamp follows. */
export function phiAt(now: number): number {
  catchUp();
  return phiUnder(now, getCamera(), isHeld());
}
/** The angle the viewer sees at `now`: `phiAt` while the ease a change of mode began is not under way, between the angle seen at the pick and it while it is. The rig poses the cards from it. */
export function shownPhiAt(now: number): number {
  catchUp();
  return shownUnder(now, getCamera(), isHeld());
}
/** The clock (ms) at which the last ease is spent; 0 when none was begun. */
export function easeEndsAt(): number {
  catchUp();
  return state.ease ? state.ease.at + EASE_MS : 0;
}
/** The clock (ms) from which the offset may move for the last change of mode: its stage, after the angle's when the camera is going to stand on its heading, at once otherwise; 0 when none was begun. */
export function offsetFreeAt(): number {
  catchUp();
  return state.ease ? state.ease.at + (state.ease.phiFirst ? STAGE_MS : 0) : 0;
}

/** Bound the speed in each mode to what the baked place sustains (`view.ts` `maxSpeed`); the anchor is taken to now first, so nothing jumps. */
export function setSpeedLimit(limit: SpeedLimit | undefined, now: number): void {
  catchUp();
  settle(now, getCamera(), isHeld());
  speedLimit = limit;
}

/**
 * Point the view at a place: the first time it is shown, or when it is not the place the heading was last anchored to, the view faces its rest azimuth
 * with the camera on its heading. The same place again changes nothing (a rebuild for a sky keeps the heading). Given `limit` (what the baked place sustains,
 * `view.ts` `maxSpeed`), it bounds the speed from this moment, before anything awaits the place's tiles.
 */
export function anchor(key: string, restDeg: number, now: number, limit?: SpeedLimit): void {
  catchUp();
  if (limit) setSpeedLimit(limit, now); // before the view is let to turn: the bound is known from the first read
  if (state.anchor === key) return;
  settle(now, getCamera(), isHeld(), { anchor: key, ease: undefined }, restDeg, 0);
  emit();
}

/**
 * A manual turn: the view direction becomes `h` now, in every mode, and the rotation stops where the viewer left it (ruling ridge-view-turn-handback): the
 * view is held in cameraState, which leaves the chosen mode as it is. A rebuild keeps the hold, a reload does not, and picking a rotation mode, the one
 * already chosen included, resumes it.
 */
export function hold(h: number, now: number): void {
  catchUp();
  const wasHeld = isHeld();
  settle(now, getCamera(), wasHeld, {}, h);
  if (wasHeld) emit();
  else holdCamera(now); // the camera's listeners tell everyone, once
}

/** Nothing turns while `on` (reduced motion), whatever the viewer chose; the view stays where it is, and what was easing is shown where it is going. */
export function freeze(on: boolean, now: number): void {
  catchUp();
  if (on === state.frozen) return;
  settle(now, getCamera(), isHeld());
  state = { ...state, frozen: on, ease: on ? undefined : state.ease };
}

/**
 * Bring `h` and `phi` into [0, 360) and the clock to `now`, changing nothing the view shows but the whole turns the unwrapped angles had gathered; tiles
 * are laid out from them, so their positions and the transforms stay small however long the page has been open. Silent: the caller lays out again.
 */
export function normalize(now: number): void {
  catchUp();
  const cam = getCamera();
  const held = isHeld();
  const wrap = (x: number): number => x - 360 * Math.floor(x / 360);
  const phi = phiUnder(now, cam, held);
  const turns = wrap(phi) - phi;
  settle(now, cam, held, { ease: state.ease && { ...state.ease, from: state.ease.from + turns } }, wrap(headingUnder(now, cam, held)), phi + turns);
}

/** Hear every change of the kinematics that the viewer's choice does not announce (a manual turn while still, a new place); returns the way to stop. */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** For tests: the state of a fresh page. */
export function resetHeading(): void {
  speedLimit = undefined;
  state = initial();
  listeners.clear();
}
