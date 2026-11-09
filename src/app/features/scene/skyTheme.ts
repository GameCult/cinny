// Which theme a sky state lights the page with. 'auto' takes the theme of the sky it resolves to
// (skyState.resolveSkyState), since that is the sky behind the text.
//
// Day and Dusk take the dark ink of Noonday Sky, Night the light ink of Midnight Sky. Each state's
// drawn sky is shaped into a luminance band (skyBand.ts) in which that ink's TEXT clears 4.5:1 on
// bare sky: Day and Dusk at least 0.2983 (dark ink), Night at most 0.0931 (light ink). skyTheme.test.ts
// pins the measured text and link ratios. Link ink is not in the band: the Night link (#609385,
// 2.36:1) and the dark links on Day and Dusk fall short, because the themes' link colours are
// derived outside this code (src/sky/skyTokens.js); lightening the Night link to a luminance of
// about 0.53 or more would clear it. The plate (skyPlate.css.ts) is still in the shell, pending
// its removal.
import { resolveSkyState } from './skyState';
import type { FixedSkyState, SkyState } from './skyState';

export type SkyThemeId = 'midnight-sky' | 'noonday-sky';

const BY_STATE: Record<FixedSkyState, SkyThemeId> = {
  day: 'noonday-sky',
  dusk: 'noonday-sky',
  night: 'midnight-sky',
};

export const skyThemeId = (state: SkyState): SkyThemeId => BY_STATE[resolveSkyState(state)];
