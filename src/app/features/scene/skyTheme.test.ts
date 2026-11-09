import { describe, expect, it } from 'vitest';
import { baked } from '../../../sky/baked';
import { AA, contrast, luminance } from '../../../sky/skyTokens.js';
import { SKY_PLATE_FALLBACK } from './skyPlate';
import { SKY_STATES, skyBackdrop, type SkyBackdrop, type SkyState } from './skyState';
import { skyThemeId } from './skyTheme';

const SKY = { 'midnight-sky': baked.midnight, 'noonday-sky': baked.noonday } as const;
const fixed = (['day', 'dusk', 'night'] as const).flatMap((s) => {
  const id = skyThemeId(s);
  return id ? [[s, id] as const] : [];
});

// WCAG contrast of an ink against the sky it is worst on, measured as skyState.test.ts does: the
// sky can show any luminance between its darkest and lightest, and contrast is lowest where the
// backdrop is closest to the ink, which is the ink's own luminance clamped into that range.
const against = (ink: string, bg: number) => {
  const li = luminance(ink);
  const [hi, lo] = li > bg ? [li, bg] : [bg, li];
  return (hi + 0.05) / (lo + 0.05);
};
const ratio = (ink: string, b: SkyBackdrop) =>
  against(ink, Math.min(b.lightest, Math.max(b.darkest, luminance(ink))));
const r2 = (n: number) => n.toFixed(2);

describe('skyThemeId', () => {
  it('leaves the theme alone in auto and picks one for every fixed state', () => {
    expect(skyThemeId('auto')).toBeUndefined();
    expect(SKY_STATES.filter((s) => s !== 'auto').map((s) => skyThemeId(s))).not.toContain(
      undefined
    );
  });

  it('lights day and dusk with dark ink and night with light ink', () => {
    expect(skyThemeId('day')).toBe('noonday-sky');
    expect(skyThemeId('dusk')).toBe('noonday-sky');
    expect(skyThemeId('night')).toBe('midnight-sky');
  });
});

describe('ink of the theme a state picks, on bare sky', () => {
  // [state, text ratio, link ratio]; a theme's own ink is not chosen for bare sky, so only day
  // and night text pass (Nibu's measurement, skyState.test.ts). Links never rest on bare sky.
  const cells: [SkyState, string, string, string, string][] = [
    ['day', 'noonday-sky', '#342d25', '7.62', '#2a4f27'],
    ['dusk', 'noonday-sky', '#342d25', '1.00', '#2a4f27'],
    ['night', 'midnight-sky', '#aeccff', '5.05', '#609385'],
  ];

  it.each(cells)('%s with %s: ink %s measures %s', (state, id, ink, want, link) => {
    const sky = SKY[id as keyof typeof SKY];
    expect(sky.tokens.Background.OnContainer).toBe(ink);
    expect(sky.link).toBe(link);
    expect(r2(ratio(ink, skyBackdrop(state)))).toBe(want);
  });

  it('only the cells that clear AA on bare sky carry text there', () => {
    const passing = fixed.filter(
      ([s, id]) => ratio(SKY[id].tokens.Background.OnContainer, skyBackdrop(s)) >= AA
    );
    expect(passing.map(([s]) => s)).toEqual(['day', 'night']);
  });
});

describe('the plate, where text cannot rest on bare sky', () => {
  // Each theme's plate: fill, ink, link and the WCAG ratios of ink and link on the fill.
  const plates = [
    ['midnight-sky', baked.midnight, '12.17', '5.68'],
    ['noonday-sky', baked.noonday, '6.70', '4.62'],
  ] as const;

  it.each(plates)('%s: ink and link on the fill', (_id, sky, inkRatio, linkRatio) => {
    expect(r2(contrast(sky.bubbles.OtherText, sky.bubbles.Other))).toBe(inkRatio);
    expect(r2(contrast(sky.link, sky.bubbles.Other))).toBe(linkRatio);
    expect(contrast(sky.bubbles.OtherText, sky.bubbles.Other)).toBeGreaterThanOrEqual(AA);
    expect(contrast(sky.link, sky.bubbles.Other)).toBeGreaterThanOrEqual(AA);
  });

  it('the other themes take fallback colours that clear AA', () => {
    const { fill, text, link } = SKY_PLATE_FALLBACK;
    expect(r2(contrast(text, fill))).toBe('10.21');
    expect(r2(contrast(link, fill))).toBe('10.03');
  });

  it('every container of the picked themes carries its text at AA', () => {
    fixed.forEach(([, id]) => {
      Object.values(SKY[id].tokens).forEach((g) => {
        expect(contrast(g.OnContainer, g.Container)).toBeGreaterThanOrEqual(AA);
      });
    });
  });
});
