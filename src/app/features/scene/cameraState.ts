// How the viewer wants the ridge camera to move: the rotation mode, the speed and the parallax offset, per viewer in localStorage. Intent only: the
// kinematics are `ridge/heading.ts`, the one clamp on the offset is `ridge/view.ts` `offsetRange`, and a scene applies this to both. Main-chunk safe
// (no ridge code is imported at runtime), as placeState and skyState are.
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
const listeners = new Set<(c: CameraChoice) => void>();

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

/** Change any of the three; listeners hear it only when something moved. */
export function setCamera(change: Partial<CameraChoice>): void {
  const next = parseCamera({ ...getCamera(), ...change });
  if (!next) return;
  const prev = getCamera();
  if (next.mode === prev.mode && next.speedDegPerS === prev.speedDegPerS && next.offsetM === prev.offsetM) return;
  current = next;
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify(next));
  } catch {
    // Storage is refused: the choice holds for this page load only.
  }
  [...listeners].forEach((cb) => cb(next));
}

export function subscribe(cb: (c: CameraChoice) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** For tests: forget what was read, so the next read starts from storage again. */
export function resetCamera(): void {
  current = undefined;
  listeners.clear();
}
