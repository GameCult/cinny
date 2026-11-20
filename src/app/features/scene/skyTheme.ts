// Which theme the drawn sky lights the page with. While a scene is on, the sky being drawn (the fixed pick, or the
// clock's state under 'auto'; `useResolvedSkyState`) alone decides the theme and, with it, the ink: Day and Dusk
// wear Noonday Sky, Night wears Midnight Sky. A person's own theme (the theme menu) stands only where no sky is
// drawn, that is with the scene off.
import type { FixedSkyState } from './skyState';

export type SkyThemeId = 'midnight-sky' | 'noonday-sky';

const BY_STATE: Record<FixedSkyState, SkyThemeId> = {
  day: 'noonday-sky',
  dusk: 'noonday-sky',
  night: 'midnight-sky',
};

/** The theme the page wears: the drawn sky's while a scene is on, otherwise none (the person's theme stands). */
export const sceneThemeId = (resolved: FixedSkyState, sceneOn: boolean): SkyThemeId | undefined =>
  sceneOn ? BY_STATE[resolved] : undefined;
