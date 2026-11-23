// The heading owner: which way the view faces (`h`) and where the camera stands on its circle against that (`phi`), as kinematics over a clock.
// Module-level state so it outlives scene rebuilds: a sky change makes a new scene and the view keeps its direction. Angles are unwrapped compass
// degrees between two `normalize` calls (the rig makes one before each stretch of motion, so they never grow with uptime); `ring.ts` is the one place
// that reasons about 0 / 360. Nothing but this module advances `h` or `phi`.
//
// The rotation mode and its speed are not held here: they are the viewer's choice, `cameraState.ts`, the one owner. This module keeps only where the view
// and the camera were at the clock `t0` and integrates them under the choice in force since, so it listens to the choice and takes the anchor to the moment
// of each change (a manual turn is a change of the choice to 'still', which a rebuild or a reload therefore keeps).
//
// The camera sits on its circle at angle `theta = h + phi`: with `phi` 0 it is pushed forward along its own heading (`view.ts` `cardPose`); rotating
// the offset alone moves `phi` and leaves the view direction where it is (ruling ridge-scene-view-submenus). `phi` is 0 whenever the view direction turns
// with the camera ('both'): picking that mode returns the camera to its heading.
import { getCamera, setCamera, subscribe as onCamera } from '../cameraState';
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
  /** Nothing turns, whatever the viewer chose (the OS asks for reduced motion): an override of the environment, not a second copy of the choice. */
  frozen: boolean;
}

const initial = (): State => ({ h0: 0, phi0: 0, t0: 0, anchor: undefined, frozen: false });
let state = initial();
const listeners = new Set<() => void>();
let unbind: (() => void) | undefined;

const turning = (cam: CameraChoice, frozen: boolean): RotationMode => (frozen ? 'still' : cam.mode);
const advanced = (now: number, cam: CameraChoice): number => (cam.speedDegPerS * (now - state.t0)) / 1000;
const headingUnder = (now: number, cam: CameraChoice): number =>
  state.h0 + (turning(cam, state.frozen) === 'both' ? advanced(now, cam) : 0);
const phiUnder = (now: number, cam: CameraChoice): number =>
  state.phi0 + (turning(cam, state.frozen) === 'offset' ? advanced(now, cam) : 0);

/** The view direction at `now` (ms): unwrapped degrees, bounded by the last `normalize` and the stretch since. */
export const headingAt = (now: number): number => headingUnder(now, getCamera());
/** The camera's angle on its circle against the heading at `now`, degrees, as `headingAt`. */
export const phiAt = (now: number): number => phiUnder(now, getCamera());

const emit = () => [...listeners].forEach((cb) => cb());

/** Take `h`, `phi` and the clock to `now` under the choice `cam` in force until now: the one way a value is replaced, so no change makes the view jump. */
function settle(now: number, cam: CameraChoice, over: Partial<State> = {}, h = headingUnder(now, cam), phi = phiUnder(now, cam)): void {
  state = { ...state, ...over, h0: h, phi0: phi, t0: now };
}

/** Listen to the viewer's choice from now on (again, if a test cleared the listeners): a change of mode or speed lands on the anchor at the moment it is made. */
function bind(): void {
  unbind?.();
  unbind = onCamera((next, prev, at) => {
    settle(at, prev, {}, undefined, next.mode === 'both' ? 0 : undefined);
  });
}

/**
 * Point the view at a place: the first time it is shown, or when it is not the place the heading was last anchored to, the view faces its rest azimuth
 * with the camera on its heading. The same place again changes nothing (a rebuild for a sky keeps the heading). Also starts listening to the viewer's choice.
 */
export function anchor(key: string, restDeg: number, now: number): void {
  bind();
  if (state.anchor === key) return;
  settle(now, getCamera(), { anchor: key }, restDeg, 0);
  emit();
}

/**
 * A manual turn: the view direction becomes `h` now, in every mode, and the rotation stops where the viewer left it (ruling ridge-view-turn-handback): the
 * viewer's mode becomes 'still', the one owner of it, so a rebuild or a reload keeps the hold and choosing a rotation mode again, the one already shown
 * included, resumes it.
 */
export function hold(h: number, now: number): void {
  const wasStill = getCamera().mode === 'still';
  settle(now, getCamera(), {}, h);
  if (wasStill) emit();
  else setCamera({ mode: 'still' }, now); // the camera's listeners tell everyone, once
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
  state = initial();
  listeners.clear();
}
