// Which sky the signed-out page is drawn against. The state is one value, kept in one
// localStorage key; whoever draws the sky (the scene, the title bar's control) reads it here, and
// `skyBackdrop` says how light or dark the sky behind the login text can be in each state, so the
// text colours can be checked against it.
import { ridgeDrawn, terrainDrawn } from './skyForState';

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

// The union of every sky a scene draws for the state: the ridge sky and the terrain sky, each from
// the function its scene uses. 'auto' follows the clock (and a URL), so it bounds all three fixed
// states. Computed on first use: the terrain range samples its sky.
const union = (ranges: readonly (SkyBackdrop | undefined)[]): SkyBackdrop => {
  const r = ranges.filter((x): x is SkyBackdrop => !!x);
  return {
    darkest: Math.min(...r.map((x) => x.darkest)),
    lightest: Math.max(...r.map((x) => x.lightest)),
  };
};

const FIXED_STATES = ['day', 'dusk', 'night'] as const;
const cache = new Map<SkyState, SkyBackdrop>();

export function skyBackdrop(state: SkyState): SkyBackdrop {
  let b = cache.get(state);
  if (!b) {
    b =
      state === 'auto'
        ? union(FIXED_STATES.map(skyBackdrop))
        : union([ridgeDrawn(state), terrainDrawn(state)]);
    cache.set(state, b);
  }
  return b;
}
