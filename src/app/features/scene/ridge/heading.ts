// The heading owner: which way the view faces (`h`) and where the camera stands on its circle against that (`phi`), as kinematics over a clock.
// Module-level state so it outlives scene rebuilds: a sky change makes a new scene and the view keeps its direction. Angles are unwrapped compass
// degrees between two `normalize` calls (the rig makes one before each stretch of motion, so they never grow with uptime); `ring.ts` is the one place
// that reasons about 0 / 360. Nothing but this module advances `h` or `phi`.
//
// The rotation mode, its speed and the hold are not held here: they are the viewer's choice and the session's hold, `cameraState.ts`, the one owner. This
// module keeps only where the view and the camera were at the clock `t0` and integrates them under the mode in effect since (the chosen mode, 'still' while
// held), with the speed bounded to what the baked place sustains in that mode (`setSpeedLimit`, derived at every read, never stored), so it listens to
// cameraState and takes the anchor to the moment of each change. A rebuild keeps the hold; a reload (a Return) does not.
//
// The camera sits on its circle at angle `theta = h + phi`: with `phi` 0 it is pushed forward along its own heading (`view.ts` `cardPose`); rotating
// the offset alone moves `phi` and leaves the view direction where it is (ruling ridge-scene-view-submenus). `phi` is 0 whenever the view direction turns
// with the camera ('both'): picking that mode returns the camera to its heading, eased over EASE_MS: `phiAt` is where the camera is going, `shownPhiAt`
// the angle the viewer sees while it gets there (the one the rig poses the cards from), so a pick moves the view and never jumps it.
import { getCamera, holdCamera, isHeld, subscribe as onCamera } from '../cameraState';
import type { CameraChoice } from '../cameraState';

/** `still`: nothing turns. `offset`: the camera circles the centre, the view direction stays. `both`: the view direction turns and the camera with it. */
export type RotationMode = 'still' | 'offset' | 'both';

interface State {
  h0: number;
  phi0: number;
  /** The clock (ms) at which `h0` and `phi0` held. */
  t0: number;
  /** What the heading was last anchored to: a baked place (its bake id), so a place change restarts at its rest azimuth and a sky change does not. */
  anchor: string | undefined;
  /** The camera's angle the viewer still sees beyond where it is going: `delta` degrees at `at` (ms), gone by `at + EASE_MS`. A change of mode sets it; the kinematics never read it. */
  ease: { delta: number; at: number } | undefined;
  /** Nothing turns, whatever the viewer chose (the OS asks for reduced motion): an override of the environment, not a second copy of the choice. */
  frozen: boolean;
}

const initial = (): State => ({ h0: 0, phi0: 0, t0: 0, anchor: undefined, ease: undefined, frozen: false });

/** How long a change of mode takes to carry the view to its new pose, ms. */
export const EASE_MS = 600;
/** What is left of an ease that began at `at` (ms), from 1 down to 0 at `at + EASE_MS` (smoothstep): the one curve of the view's easing, the rig's offset included. */
export const easeLeft = (at: number, now: number): number => {
  const x = Math.min(1, Math.max(0, (now - at) / EASE_MS));
  return 1 - x * x * (3 - 2 * x);
};
let state = initial();
const listeners = new Set<() => void>();
let unbind: (() => void) | undefined;

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
const headingUnder = (now: number, cam: CameraChoice, held = isHeld()): number =>
  state.h0 + (turning(cam, held, state.frozen) === 'both' ? advanced(now, cam) : 0);
const phiUnder = (now: number, cam: CameraChoice, held = isHeld()): number =>
  state.phi0 + (turning(cam, held, state.frozen) === 'offset' ? advanced(now, cam) : 0);

/** The view direction at `now` (ms): unwrapped degrees, bounded by the last `normalize` and the stretch since. */
export const headingAt = (now: number): number => headingUnder(now, getCamera());
/** The camera's angle on its circle against the heading at `now`, degrees, as `headingAt`: where it is going, which the offset's clamp follows. */
export const phiAt = (now: number): number => phiUnder(now, getCamera());
const easeTerm = (now: number): number => (state.ease ? state.ease.delta * easeLeft(state.ease.at, now) : 0);
/** The angle the viewer sees at `now`: `phiAt` plus what is left of the ease a change of mode began. The rig poses the cards from it. */
export const shownPhiAt = (now: number): number => phiAt(now) + easeTerm(now);
/** The clock (ms) at which the last ease is spent; 0 when none was begun. */
export const easeEndsAt = (): number => (state.ease ? state.ease.at + EASE_MS : 0);

const emit = () => [...listeners].forEach((cb) => cb());

/** Take `h`, `phi` and the clock to `now` under the choice `cam` in force until now: the one way a value is replaced, so no change makes the view jump. */
function settle(
  now: number,
  cam: CameraChoice,
  over: Partial<State> = {},
  h = headingUnder(now, cam),
  phi = phiUnder(now, cam)
): void {
  state = { ...state, ...over, h0: h, phi0: phi, t0: now };
}

/** A change of the viewer's choice lands on the anchor at the moment it is made. */
function onChange(next: CameraChoice, prev: CameraChoice, at: number, wasHeld: boolean): void {
  // Taken to the moment of the change under the choice and hold in force until it; picking 'both' puts the camera on its heading, and the angle the viewer
  // saw until then is eased out (by the shortest way round) instead of dropped.
  const shown = phiUnder(at, prev, wasHeld) + easeTerm(at);
  settle(at, prev, {}, headingUnder(at, prev, wasHeld), next.mode === 'both' && !isHeld() ? 0 : phiUnder(at, prev, wasHeld));
  const gap = shown - state.phi0;
  const delta = gap - 360 * Math.round(gap / 360);
  state = { ...state, ease: Math.abs(delta) < 1e-9 ? undefined : { delta, at } };
}

/**
 * Listen to the viewer's choice (again, if a test cleared the listeners). The listener is one function, so listening again keeps its place in the order
 * cameraState calls them: the owner settles before any listener that was added after it reads it.
 */
function bind(): void {
  unbind = onCamera(onChange);
}

/** Bound the speed in each mode to what the baked place sustains (`view.ts` `maxSpeed`); the anchor is taken to now first, so nothing jumps. */
export function setSpeedLimit(limit: SpeedLimit | undefined, now: number): void {
  settle(now, getCamera());
  speedLimit = limit;
}

/**
 * Point the view at a place: the first time it is shown, or when it is not the place the heading was last anchored to, the view faces its rest azimuth
 * with the camera on its heading. The same place again changes nothing (a rebuild for a sky keeps the heading). Also starts listening to the viewer's choice and, given
 * `limit` (what the baked place sustains, `view.ts` `maxSpeed`), bounds the speed from this moment, before anything awaits the place's tiles.
 */
export function anchor(key: string, restDeg: number, now: number, limit?: SpeedLimit): void {
  bind();
  if (limit) setSpeedLimit(limit, now); // before the view is let to turn: the bound is known from the first read
  if (state.anchor === key) return;
  settle(now, getCamera(), { anchor: key, ease: undefined }, restDeg, 0);
  emit();
}

/**
 * A manual turn: the view direction becomes `h` now, in every mode, and the rotation stops where the viewer left it (ruling ridge-view-turn-handback): the
 * view is held in cameraState, which leaves the chosen mode as it is. A rebuild keeps the hold, a reload does not, and picking a rotation mode, the one
 * already chosen included, resumes it.
 */
export function hold(h: number, now: number): void {
  const wasHeld = isHeld();
  settle(now, getCamera(), {}, h);
  if (wasHeld) emit();
  else holdCamera(now); // the camera's listeners tell everyone, once
}

/** Nothing turns while `on` (reduced motion), whatever the viewer chose; the view stays where it is. */
export function freeze(on: boolean, now: number): void {
  if (on === state.frozen) return;
  settle(now, getCamera());
  state = { ...state, frozen: on };
}

/**
 * Bring `h` and `phi` into [0, 360) and the clock to `now`, changing nothing the view shows but the whole turns the unwrapped angles had gathered; tiles
 * are laid out from them, so their positions and the transforms stay small however long the page has been open. Silent: the caller lays out again.
 */
export function normalize(now: number): void {
  const cam = getCamera();
  const wrap = (x: number): number => x - 360 * Math.floor(x / 360);
  settle(now, cam, {}, wrap(headingUnder(now, cam)), wrap(phiUnder(now, cam)));
}

/** Hear every change of the kinematics that the viewer's choice does not announce (a manual turn while still, a new place); returns the way to stop. */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** For tests: the state of a fresh page. */
export function resetHeading(): void {
  unbind?.();
  unbind = undefined;
  speedLimit = undefined;
  state = initial();
  listeners.clear();
}
