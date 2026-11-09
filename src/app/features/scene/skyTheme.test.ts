import { describe, expect, it } from 'vitest';
import { baked } from '../../../sky/baked';
import { AA, contrast, luminance } from '../../../sky/skyTokens.js';
import { SKY_STATES, skyBackdrop, type SkyState } from './skyState';
import { skyThemeId } from './skyTheme';

const SKY = { 'midnight-sky': baked.midnight, 'noonday-sky': baked.noonday } as const;
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe('skyThemeId', () => {
  it('leaves the theme alone in auto and picks one for every fixed state', () => {
    expect(skyThemeId('auto')).toBeUndefined();
    SKY_STATES.filter((s) => s !== 'auto').forEach((s) => {
      expect(skyThemeId(s)).toBeDefined();
    });
  });

  it('lights day and dusk with dark ink and night with light ink', () => {
    expect(skyThemeId('day')).toBe('noonday-sky');
    expect(skyThemeId('dusk')).toBe('noonday-sky');
    expect(skyThemeId('night')).toBe('midnight-sky');
  });
});

describe('contrast of the theme a state picks', () => {
  const picked = SKY_STATES.flatMap((s) => {
    const id = skyThemeId(s);
    return id ? [[s, SKY[id]] as const] : [];
  });

  it.each(picked)('%s: every container carries its text at AA', (_state, sky) => {
    Object.values(sky.tokens).forEach((group) => {
      expect(contrast(group.OnContainer, group.Container)).toBeGreaterThanOrEqual(AA);
    });
  });

  it.each(picked)('%s: links read at AA on the background surface', (_state, sky) => {
    expect(contrast(sky.link, sky.tokens.Background.Container)).toBeGreaterThanOrEqual(AA);
  });

  // Bare sky has no surface under it. Text may sit there only where the ink clears AA against
  // both the darkest and the lightest sky the state can show; anywhere else it needs a surface.
  const onBareSky = (state: SkyState): number => {
    const id = skyThemeId(state);
    if (!id) return 0;
    const ink = luminance(SKY[id].tokens.Background.OnContainer);
    const { darkest, lightest } = skyBackdrop(state);
    return Math.min(ratio(ink, darkest), ratio(ink, lightest));
  };

  it('day and night text on bare sky clears AA', () => {
    expect(onBareSky('day')).toBeGreaterThanOrEqual(AA);
    expect(onBareSky('night')).toBeGreaterThanOrEqual(AA);
  });

  it('dusk text on bare sky does not, so dusk text stays on surfaces', () => {
    expect(onBareSky('dusk')).toBeLessThan(AA);
  });
});
