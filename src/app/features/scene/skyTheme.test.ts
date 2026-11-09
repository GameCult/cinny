import { describe, expect, it } from 'vitest';
import { atStandardTime } from './standardTime.testkit';
import { baked } from '../../../sky/baked';
import { AA, contrast, luminance } from '../../../sky/skyTokens.js';
import { Editor } from '../../components/editor/Editor.css';
import { PageContent, PageNavContent } from '../../components/page/style.css';
import { CallStatus } from '../call-status/styles.css';
import { MembersDrawer } from '../room/MembersDrawer.css';
import { RoomViewTyping } from '../room/RoomViewTyping.css';
import { SKY_PLATE_FALLBACK } from './skyPlate';
import { SkyPlate, plateRegions } from './skyPlate.css';
import { getResolvedSkyState, setSkyClock, skyBackdrop } from './skyState';
import type { SkyBackdrop } from './skyState';
import type { FixedSkyState } from './skyBand';
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
  it('picks a theme for each explicit state', () => {
    expect(skyThemeId('day')).toBe('noonday-sky');
    expect(skyThemeId('dusk')).toBe('noonday-sky');
    expect(skyThemeId('night')).toBe('midnight-sky');
  });

  it('picks none for auto, at any hour: auto never overrides a signed-in theme', () => {
    [0, 6, 12, 18, 23].forEach((h) => {
      setSkyClock(() => atStandardTime(h, 10));
      expect(skyThemeId('auto')).toBeUndefined();
    });
    setSkyClock();
  });

  it('is what a wiring that follows the sky reads: the resolved state names a theme', () => {
    setSkyClock(() => atStandardTime(12));
    expect(skyThemeId(getResolvedSkyState())).toBe('noonday-sky');
    setSkyClock(() => atStandardTime(0));
    expect(skyThemeId(getResolvedSkyState())).toBe('midnight-sky');
    setSkyClock();
  });
});

describe('ink of the theme a state picks, on bare sky', () => {
  // Per state: the picked theme, its text ink and link, and their WCAG ratios on the sky the scenes
  // draw (skyBackdrop, the worst case over its band). Text clears 4.5 in every state. Link clears
  // on day and not on dusk or night: the links are derived in src/sky/skyTokens.js, outside the band, and these
  // numbers are recorded as they are measured (Night's #609385 would clear 4.5 at a luminance of about 0.53 or more).
  // 'auto' resolves from the clock to one of these three and has the same numbers.
  const cells: [FixedSkyState, string, string, string, string, string][] = [
    ['day', 'noonday-sky', '#342d25', '6.64', '#2a4f27', '4.57'],
    ['dusk', 'noonday-sky', '#342d25', '4.60', '#2a4f27', '3.17'],
    ['night', 'midnight-sky', '#aeccff', '4.91', '#609385', '2.29'],
  ];

  it.each(cells)(
    '%s with %s: text %s is %s, link %s is %s',
    (state, id, ink, want, link, wantLink) => {
      const sky = SKY[id as keyof typeof SKY];
      expect(sky.tokens.Background.OnContainer).toBe(ink);
      expect(sky.link).toBe(link);
      expect(r2(ratio(ink, skyBackdrop(state)))).toBe(want);
      expect(r2(ratio(link, skyBackdrop(state)))).toBe(wantLink);
    }
  );

  it.each(cells)('%s: text clears AA', (state, _id, ink) => {
    expect(ratio(ink, skyBackdrop(state))).toBeGreaterThanOrEqual(AA);
  });

  it('link clears AA on day (the terrain camera sees only the lighter sky) and falls short on dusk and night', () => {
    const link = (s: FixedSkyState, id: keyof typeof SKY) => ratio(SKY[id].link, skyBackdrop(s));
    expect(link('day', 'noonday-sky')).toBeGreaterThanOrEqual(AA);
    expect(link('dusk', 'noonday-sky')).toBeLessThan(AA);
    expect(link('night', 'midnight-sky')).toBeLessThan(AA);
  });

  it.each([
    [12, 'day'],
    [18, 'dusk'],
    [0, 'night'],
  ] as const)('auto at %s:00 has the numbers of %s', (hour, state) => {
    setSkyClock(() => atStandardTime(hour, hour === 18 ? 10 : 0));
    const id = skyThemeId(getResolvedSkyState()) as keyof typeof SKY;
    expect(id).toBe(skyThemeId(state));
    const { tokens, link } = SKY[id];
    const text = tokens.Background.OnContainer;
    expect(r2(ratio(text, skyBackdrop('auto')))).toBe(r2(ratio(text, skyBackdrop(state))));
    expect(r2(ratio(link, skyBackdrop('auto')))).toBe(r2(ratio(link, skyBackdrop(state))));
    setSkyClock();
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

describe('regions that sit on the plate', () => {
  // Every region whose text would otherwise rest on bare sky joins the one plate rule. The ink
  // and link of that plate are pinned above; this pins who is on it.
  const on = (cls: string) => expect(plateRegions).toContain(cls);

  it('plates the composer, the members drawer, the call status bar and the call view', () => {
    on(`.${Editor}`);
    on(`.${MembersDrawer}`);
    on(`.${CallStatus}`);
    on(`.${SkyPlate}`);
  });

  it('plates the room list, list pages, typing and Following bars and every header', () => {
    on(`.${PageNavContent}`);
    on(`.${PageContent}`);
    on(`.${RoomViewTyping}`);
    on('#root header');
    expect(plateRegions.some((r) => r.includes(':not(:has('))).toBe(true);
  });
});
