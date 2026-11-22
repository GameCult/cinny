// The heading owner: which way the view faces (`h`) and where the camera stands on its circle against that (`phi`), as kinematics over a clock.
// Pure state and subscribe, module-level so it outlives scene rebuilds: a sky change makes a new scene and the view keeps its direction. Angles are
// unwrapped compass degrees, never wrapped by a consumer (`ring.ts` is the one place that reasons about 0 / 360). Nothing but this module advances
// `h` or `phi`; the viewer's intent (mode, speed, offset) is `cameraState.ts`, and a scene applies it here.
//
// The camera sits on its circle at angle `theta = h + phi`: with `phi` 0 it is pushed forward along its own heading (`view.ts` `cardPose`); rotating
// the offset alone moves `phi` and leaves the view direction where it is (ruling ridge-scene-view-submenus).

/** `still`: nothing turns. `offset`: the camera circles the centre, the view direction stays. `both`: the view direction turns and the camera with it. */
export type RotationMode = 'still' | 'offset' | 'both';

interface State {
  mode: RotationMode;
  /** Degrees per second, signed. */
  rate: number;
  h0: number;
  phi0: number;
  /** The clock (ms) at which `h0` and `phi0` held. */
  t0: number;
  /** What the heading was last anchored to: a baked place (its bake id), so a place change restarts at its rest azimuth and a sky change does not. */
  anchor: string | undefined;
}

const initial = (): State => ({ mode: 'still', rate: 0, h0: 0, phi0: 0, t0: 0, anchor: undefined });
let state = initial();
const listeners = new Set<() => void>();

const advanced = (now: number): number => (state.rate * (now - state.t0)) / 1000;

/** The view direction at `now` (ms), unwrapped degrees. */
export const headingAt = (now: number): number => state.h0 + (state.mode === 'both' ? advanced(now) : 0);
/** The camera's angle on its circle against the heading at `now`, unwrapped degrees. */
export const phiAt = (now: number): number => state.phi0 + (state.mode === 'offset' ? advanced(now) : 0);
export const getMode = (): RotationMode => state.mode;
export const getRate = (): number => state.rate;

const emit = () => [...listeners].forEach((cb) => cb());

/** Take `h`, `phi` and the clock to `now` and change what advances them: the one way a value is replaced, so no change makes the view jump. */
function rebase(now: number, over: Partial<State> = {}, h = headingAt(now), phi = phiAt(now)): void {
  state = { ...state, ...over, h0: h, phi0: phi, t0: now };
  emit();
}

/**
 * Point the view at a place: the first time it is shown, or when it is not the place the heading was last anchored to, the view faces its rest azimuth
 * with the camera on its heading. The same place again changes nothing (a rebuild for a sky keeps the heading).
 */
export function anchor(key: string, restDeg: number, now: number): void {
  if (state.anchor === key) return;
  rebase(now, { anchor: key }, restDeg, 0);
}

/** A manual turn: the view direction becomes `h` now, in every mode, and the rotation stops where the viewer left it (ruling ridge-view-turn-handback); a mode chosen again resumes it. */
export function hold(h: number, now: number): void {
  rebase(now, { mode: 'still' }, h);
}

export function setMode(mode: RotationMode, now: number): void {
  if (mode !== state.mode) rebase(now, { mode });
}

export function setRate(rate: number, now: number): void {
  if (rate !== state.rate) rebase(now, { rate });
}

/** Hear every change of the kinematics (a manual turn, a mode, a rate, a new place); returns the way to stop. */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** For tests: the state of a fresh page. */
export function resetHeading(): void {
  state = initial();
  listeners.clear();
}
