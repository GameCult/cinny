// How the viewer wants the ridge camera to move: the rotation mode, the speed and the parallax offset, per viewer in localStorage. The one owner of the
// chosen mode, speed and offset (persisted, never rewritten by anything but the viewer: the clamp on the offset, `ridge/view.ts` `offsetRange`, and the bound
// on the speed, `maxSpeed`, are derived from them at read for the mode and the bake in force) and of the hold: a manual turn (`ridge/heading.ts` `hold`) makes the
// mode in effect 'still' until the viewer picks a mode, the one already chosen included. The hold is session state: a rebuild keeps it, a reload does not
// (a reload is a Return). `ridge/heading.ts` integrates the view direction over the mode in effect. Main-chunk safe (no ridge code is imported at runtime), as placeState and skyState are.
import type { RotationMode } from './ridge/heading';

export const CAMERA_KEY = 'ratatoskr.camera';

export interface CameraChoice {
  mode: RotationMode;
  /** Degrees per second the view (or the camera on its circle) turns at. */
  speedDegPerS: number;
  /** The camera's offset from the bake centre in metres, forward positive; a scene clamps it to the place's range. */
  offsetM: number;
}

/**
 * What a first visit sees (question ridge-view-defaults, provisional): a turn in ten minutes with the camera 200 m forward, view direction and camera
 * together (ruling ridge-scene-view-fullscreen). A visit that asks for reduced motion starts with nothing turning.
 */
export const DEFAULT_CAMERA: CameraChoice = { mode: 'both', speedDegPerS: 0.6, offsetM: 200 };

const MODES: readonly RotationMode[] = ['still', 'offset', 'both'];

/** A stored value as a choice, or undefined when it is not one (an unknown mode, a speed or offset that is not a finite number). */
export function parseCamera(raw: unknown): CameraChoice | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const c = raw as Record<string, unknown>;
  if (
    !MODES.includes(c.mode as RotationMode) ||
    typeof c.speedDegPerS !== 'number' ||
    !Number.isFinite(c.speedDegPerS) ||
    typeof c.offsetM !== 'number' ||
    !Number.isFinite(c.offsetM)
  ) {
    return undefined;
  }
  return { mode: c.mode as RotationMode, speedDegPerS: c.speedDegPerS, offsetM: c.offsetM };
}

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
};

let current: CameraChoice | undefined;
/** Hears a change of the choice or of the hold: the choice now, what it was, the clock, and whether the view was held before. */
type Listener = (next: CameraChoice, prev: CameraChoice, at: number, wasHeld: boolean) => void;
let held = false;
const listeners = new Set<Listener>();

/** A change of what turns the view (the mode, the speed or the hold), whole: the heading is integrated over the choices in force, so it takes them in the order they were made. */
export interface CameraChange {
  next: CameraChoice;
  prev: CameraChoice;
  at: number;
  wasHeld: boolean;
  /** Whether the view is held after the change. */
  held: boolean;
}
/** The changes `ridge/heading.ts` has not taken yet: kept only once it has asked (a page with no ridge scene keeps none). */
let changes: CameraChange[] | undefined;
const NONE: readonly CameraChange[] = [];
/** Hand over the changes of what turns the view since the last call, oldest first: the one reader is the heading owner, which computes the heading from them whenever it is read, so who listens and in what order is no business of its. */
export function takeChanges(): readonly CameraChange[] {
  changes ??= [];
  return changes.length ? changes.splice(0) : NONE;
}
const record = (c: CameraChange): void => {
  if (c.next.mode !== c.prev.mode || c.next.speedDegPerS !== c.prev.speedDegPerS || c.held !== c.wasHeld) changes?.push(c);
};
const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function load(): CameraChoice {
  try {
    const stored = localStorage.getItem(CAMERA_KEY);
    const parsed = stored === null ? undefined : parseCamera(JSON.parse(stored));
    if (parsed) return parsed;
  } catch {
    // Storage is unreadable (private mode, bad JSON): the defaults hold for this page load.
  }
  return reducedMotion() ? { ...DEFAULT_CAMERA, mode: 'still' } : { ...DEFAULT_CAMERA };
}

export const getCamera = (): CameraChoice => {
  current ??= load();
  return current;
};

/** Change any of the three, at the clock `at` (ms, `performance.now()` by default); listeners hear it, with what it was and `at`, only when something moved. */
export function setCamera(change: Partial<CameraChoice>, at: number = clock()): void {
  const next = parseCamera({ ...getCamera(), ...change });
  if (!next) return;
  const prev = getCamera();
  const wasHeld = held;
  // Picking a mode, the one already chosen included, ends a hold: it is a change whenever a hold is on.
  const resumes = wasHeld && change.mode !== undefined;
  const same = next.mode === prev.mode && next.speedDegPerS === prev.speedDegPerS && next.offsetM === prev.offsetM;
  if (same && !resumes) return;
  current = next;
  if (resumes) held = false;
  if (!same) {
    try {
      localStorage.setItem(CAMERA_KEY, JSON.stringify(next));
    } catch {
      // Storage is refused: the choice holds for this page load only.
    }
  }
  record({ next, prev, at, wasHeld, held });
  [...listeners].forEach((cb) => cb(next, prev, at, wasHeld));
}

/** A manual turn is on: the mode in effect is 'still' whatever the viewer chose. Not stored. */
export const isHeld = (): boolean => held;

/** The mode in effect: the viewer's choice, 'still' while the view is held. */
export const effectiveMode = (): RotationMode => (held ? 'still' : getCamera().mode);

/** Take the view by hand: hold it. Listeners hear it only when it was not held already. */
export function holdCamera(at: number = clock()): void {
  if (held) return;
  held = true;
  const cam = getCamera();
  record({ next: cam, prev: cam, at, wasHeld: false, held: true });
  [...listeners].forEach((cb) => cb(cam, cam, at, false));
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** For tests: forget what was read, so the next read starts from storage again. */
export function resetCamera(): void {
  current = undefined;
  held = false;
  changes = undefined;
  listeners.clear();
}
