// Which sky the signed-out page is drawn against. The state is one value, kept in one
// localStorage key; whoever draws the sky (the scene, the title bar's control) reads it here, and
// `skyBackdrop` says how light or dark the sky behind the login text can be in each state, so the
// text colours can be checked against it.
import { baked } from '../../../sky/baked';
import { luminance } from '../../../sky/skyTokens.js';
import { skyColours } from './ridge/skyColour';

export type SkyState = 'auto' | 'day' | 'dusk' | 'night';

export const SKY_STATES: readonly SkyState[] = ['auto', 'day', 'dusk', 'night'];
export const SKY_STATE_KEY = 'ratatoskr.skyState';

const isSkyState = (v: unknown): v is SkyState => SKY_STATES.includes(v as SkyState);

function load(): SkyState {
  try {
    const stored = localStorage.getItem(SKY_STATE_KEY);
    return isSkyState(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

let current: SkyState | undefined;
const listeners = new Set<(s: SkyState) => void>();

export const getSkyState = (): SkyState => {
  current ??= load();
  return current;
};

export function setSkyState(s: SkyState): void {
  if (!isSkyState(s)) return;
  const changed = s !== getSkyState();
  current = s;
  try {
    localStorage.setItem(SKY_STATE_KEY, s);
  } catch {
    // Storage is refused (private mode, quota): the choice holds for this page load only.
  }
  if (changed) [...listeners].forEach((cb) => cb(s));
}

export function subscribe(cb: (s: SkyState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Relative luminance (WCAG, 0..1) of the lightest and darkest sky the state can show behind the
 * page. Light ink is worst against `lightest`, dark ink against `darkest`. 'auto' follows the
 * clock, so it can show any of the three fixed skies and bounds all of them.
 */
export interface SkyBackdrop {
  readonly darkest: number;
  readonly lightest: number;
}

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const bound = (colours: readonly string[]): SkyBackdrop => {
  const l = colours.map(luminance);
  return { darkest: Math.min(...l), lightest: Math.max(...l) };
};

const FIXED: Record<Exclude<SkyState, 'auto'>, SkyBackdrop> = (() => {
  const dusk = skyColours();
  return {
    day: bound(baked.noonday.gradient),
    dusk: bound([dusk.top, dusk.mid, dusk.horizon].map(hex)),
    night: bound(baked.midnight.gradient),
  };
})();

export function skyBackdrop(state: SkyState): SkyBackdrop {
  if (state !== 'auto') return FIXED[state];
  const all = Object.values(FIXED);
  return {
    darkest: Math.min(...all.map((b) => b.darkest)),
    lightest: Math.max(...all.map((b) => b.lightest)),
  };
}
