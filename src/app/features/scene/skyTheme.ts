// Which theme a sky state lights the page with. 'auto' picks none: it never overrides a person's theme
// (the stored one when signed in, Midnight Sky when signed out). A wiring that follows the sky when no theme
// is stored reads `getResolvedSkyState` (skyState.ts) and passes that fixed state here.
//
// Day and Dusk take the dark ink of Noonday Sky, Night the light ink of Midnight Sky. Each state's
// drawn sky is shaped into a luminance band (skyBand.ts) in which that ink's TEXT clears 4.5:1 on
// bare sky: Day and Dusk at least 0.2983 (dark ink), Night at most 0.0931 (light ink). skyTheme.test.ts
// pins the measured text and link ratios. Link ink is not in the band: the Day and Dusk links are dark
// and fall short of 4.5 where the sky is below about 0.455 (Dusk: 3.17), because the themes' link colours are
// derived outside this code (src/sky/skyTokens.js). Midnight Sky's link is derived there against the lightest Night sky
// (4.53 on it, 5.43 on the darkest). The plate (skyPlate.css.ts) is still in the shell, pending
// its removal.
import type { FixedSkyState, SkyState } from './skyState';

export type SkyThemeId = 'midnight-sky' | 'noonday-sky';

const BY_STATE: Record<FixedSkyState, SkyThemeId> = {
  day: 'noonday-sky',
  dusk: 'noonday-sky',
  night: 'midnight-sky',
};

export const skyThemeId = (state: SkyState): SkyThemeId | undefined =>
  state === 'auto' ? undefined : BY_STATE[state];

/**
 * The theme the page wears: a fixed sky state always picks its theme; 'auto' follows the resolved sky (`resolved`, the
 * clock's state) only while a scene is on and the person has not chosen a theme of their own, and otherwise picks none.
 * Signed-out pages choose no theme, so they pass `userChoseTheme: false`.
 */
export const sceneThemeId = (
  state: SkyState,
  resolved: FixedSkyState,
  sceneOn: boolean,
  userChoseTheme: boolean
): SkyThemeId | undefined => {
  if (state !== 'auto') return BY_STATE[state];
  return sceneOn && !userChoseTheme ? BY_STATE[resolved] : undefined;
};
