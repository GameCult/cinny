// Which theme a sky state lights the page with. 'auto' picks none: the page keeps the theme it
// would have had (the user's choice when signed in, Midnight Sky when signed out).
//
// Day and Dusk take the dark ink of Noonday Sky, Night the light ink of Midnight Sky. Dusk's
// gradient runs from near-black to bright orange, so no single ink reads on all of it; Dusk
// text therefore only ever sits on a theme surface, never on bare sky (skyTheme.test.ts).
import type { SkyState } from './skyState';

export type SkyThemeId = 'midnight-sky' | 'noonday-sky';

const BY_STATE: Record<Exclude<SkyState, 'auto'>, SkyThemeId> = {
  day: 'noonday-sky',
  dusk: 'noonday-sky',
  night: 'midnight-sky',
};

export const skyThemeId = (state: SkyState): SkyThemeId | undefined =>
  state === 'auto' ? undefined : BY_STATE[state];
