// Which theme a sky state lights the page with. 'auto' picks none: the page keeps the theme it
// would have had (the user's choice when signed in, Midnight Sky when signed out).
//
// Day and Dusk take the dark ink of Noonday Sky, Night the light ink of Midnight Sky. On bare sky
// only Night's text clears 4.5:1 (5.05); Day's sky reaches 0.919 luminance and Dusk's spans
// 0.017 to 0.965, so no ink holds there. Text therefore never rests on bare sky: every region
// that would is a plate (skyPlate.css.ts), and skyTheme.test.ts pins the numbers.
import type { SkyState } from './skyState';

export type SkyThemeId = 'midnight-sky' | 'noonday-sky';

const BY_STATE: Record<Exclude<SkyState, 'auto'>, SkyThemeId> = {
  day: 'noonday-sky',
  dusk: 'noonday-sky',
  night: 'midnight-sky',
};

export const skyThemeId = (state: SkyState): SkyThemeId | undefined =>
  state === 'auto' ? undefined : BY_STATE[state];
