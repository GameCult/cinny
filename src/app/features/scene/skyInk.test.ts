import chroma from 'chroma-js';
import { describe, expect, it } from 'vitest';
import { baked } from '../../../sky/baked';
import { AA, NIGHT_SKY_LIGHTEST, luminance } from '../../../sky/skyTokens.js';
import { indexColorMXID } from '../../../util/colorMXID';
import type { FixedSkyState } from './skyBand';
import {
  LIGHTEST_PATCH,
  NIGHT_INK_MAX_L,
  NOTICE_GROUND,
  inkForState,
  labelInk,
  noticeInk,
  sceneInk,
  userColorInk,
} from './skyInk';
import { sceneThemeId } from './skyTheme';

// Every name colour the client can show over the scene, per state and viewport: Aqua's key colour #22d3e6 as
// accessibleColor leaves it (Lab L capped to 50 on a light theme: #00889a; unchanged on a dark one: #22d3e6), and
// the eight hash hues of the theme the state wears (noonday for day and dusk, midnight for night). Columns: name,
// state, phone, colour in, ink out. Aqua's day and dusk rows are the values measured in
// ratatoskr-sidebar-contrast-20261110/results.md (T4): #05707f, #016a78, #055763, #03454f, and #43e5f8 at night.
const TABLE: Array<[string, FixedSkyState, boolean, string, string]> = [
  ['aqua', 'day', false, '#00889a', '#05707f'],
  ['aqua', 'day', true, '#00889a', '#016a78'],
  ['aqua', 'dusk', false, '#00889a', '#055763'],
  ['aqua', 'dusk', true, '#00889a', '#03454f'],
  ['aqua', 'night', false, '#22d3e6', '#43e5f8'],
  ['aqua', 'night', true, '#22d3e6', '#87f1ff'],
  ['hash1', 'day', false, '#2b4675', '#2b4675'],
  ['hash1', 'day', true, '#2b4675', '#2b4675'],
  ['hash1', 'dusk', false, '#2b4675', '#2b4675'],
  ['hash1', 'dusk', true, '#2b4675', '#233e6c'],
  ['hash1', 'night', false, '#4683ff', '#bcd3ff'],
  ['hash1', 'night', true, '#4683ff', '#cbddfe'],
  ['hash2', 'day', false, '#5d366d', '#5d366d'],
  ['hash2', 'day', true, '#5d366d', '#5d366d'],
  ['hash2', 'dusk', false, '#5d366d', '#5d366d'],
  ['hash2', 'dusk', true, '#5d366d', '#562f66'],
  ['hash2', 'night', false, '#986fff', '#d4cbfe'],
  ['hash2', 'night', true, '#986fff', '#ded7fe'],
  ['hash3', 'day', false, '#214e3e', '#214e3e'],
  ['hash3', 'day', true, '#214e3e', '#214e3e'],
  ['hash3', 'dusk', false, '#214e3e', '#214e3e'],
  ['hash3', 'dusk', true, '#214e3e', '#184636'],
  ['hash3', 'night', false, '#3893b1', '#86defe'],
  ['hash3', 'night', true, '#3893b1', '#ace8ff'],
  ['hash4', 'day', false, '#6d334a', '#6d334a'],
  ['hash4', 'day', true, '#6d334a', '#6d334a'],
  ['hash4', 'dusk', false, '#6d334a', '#6d334a'],
  ['hash4', 'dusk', true, '#6d334a', '#652c43'],
  ['hash4', 'night', false, '#b26adc', '#e8c7fe'],
  ['hash4', 'night', true, '#b26adc', '#edd2ff'],
  ['hash5', 'day', false, '#5f401d', '#5f401d'],
  ['hash5', 'day', true, '#5f401d', '#5f401d'],
  ['hash5', 'dusk', false, '#5f401d', '#5f401d'],
  ['hash5', 'dusk', true, '#5f401d', '#563814'],
  ['hash5', 'night', false, '#9f8365', '#ecceae'],
  ['hash5', 'night', true, '#9f8365', '#f6d8b7'],
  ['hash6', 'day', false, '#204c52', '#204c52'],
  ['hash6', 'day', true, '#204c52', '#204c52'],
  ['hash6', 'dusk', false, '#204c52', '#204c52'],
  ['hash6', 'dusk', true, '#204c52', '#19454b'],
  ['hash6', 'night', false, '#358dde', '#b1d7ff'],
  ['hash6', 'night', true, '#358dde', '#c6e1fe'],
  ['hash7', 'day', false, '#41426c', '#41426c'],
  ['hash7', 'day', true, '#41426c', '#41426c'],
  ['hash7', 'dusk', false, '#41426c', '#41426c'],
  ['hash7', 'dusk', true, '#41426c', '#3b3b65'],
  ['hash7', 'night', false, '#677dff', '#c4d1fe'],
  ['hash7', 'night', true, '#677dff', '#d3ddfe'],
  ['hash8', 'day', false, '#3f4a20', '#3f4a20'],
  ['hash8', 'day', true, '#3f4a20', '#3f4a20'],
  ['hash8', 'dusk', false, '#3f4a20', '#3f4a20'],
  ['hash8', 'dusk', true, '#3f4a20', '#394319'],
  ['hash8', 'night', false, '#6a926a', '#b2ddb1'],
  ['hash8', 'night', true, '#6a926a', '#c0ebc0'],
];

const patchRatio = (hex: string, state: FixedSkyState, phone: boolean) => {
  const p = LIGHTEST_PATCH[state][phone ? 'phone' : 'desktop'];
  const l = luminance(hex);
  return (Math.max(l, p) + 0.05) / (Math.min(l, p) + 0.05);
};
const hueGap = (a: string, b: string) => {
  const d = Math.abs(chroma(a).oklch()[2] - chroma(b).oklch()[2]) % 360;
  return Math.min(d, 360 - d);
};

describe('inkForState', () => {
  it.each(TABLE)('%s %s phone=%s: %s -> %s', (_name, state, phone, base, ink) => {
    expect(inkForState(base, { state, phone })).toBe(ink);
  });

  it('clears 4.5:1 on the lightest patch, keeps the hue, and moves lightness the way the state needs', () => {
    TABLE.forEach(([, state, phone, base, ink]) => {
      const [l0] = chroma(base).oklch();
      const [l1] = chroma(ink).oklch();
      if (ink === base) {
        expect(patchRatio(base, state, phone)).toBeGreaterThanOrEqual(AA);
        return;
      }
      expect(state === 'night' ? l1 > l0 : l1 < l0).toBe(true);
      expect(hueGap(base, ink)).toBeLessThan(2);
      if (l1 < NIGHT_INK_MAX_L - 0.006)
        expect(patchRatio(ink, state, phone)).toBeGreaterThanOrEqual(AA);
    });
  });

  it('stops lightening at NIGHT_INK_MAX_L: a phone-night name keeps its hue instead of reaching 4.5:1 on the one pale snow patch', () => {
    const aqua = inkForState('#22d3e6', { state: 'night', phone: true });
    expect(aqua).toBe('#87f1ff');
    expect(chroma(aqua).oklch()[0]).toBeLessThanOrEqual(NIGHT_INK_MAX_L);
    expect(chroma(aqua).oklch()[1]).toBeGreaterThan(0.08);
    expect(patchRatio(aqua, 'night', true)).toBeGreaterThan(3.9);
    // The one-patch figure is what the cap gives up; against the sky's own lightest (skyBackdrop) it clears AA.
    expect((luminance(aqua) + 0.05) / (NIGHT_SKY_LIGHTEST + 0.05)).toBeGreaterThanOrEqual(AA);
  });

  it('leaves a colour that already clears its patch untouched, and a non-colour alone', () => {
    expect(inkForState('#2b4675', { state: 'day', phone: false })).toBe('#2b4675');
    expect(inkForState('var(--mx-uc-1)', { state: 'day', phone: false })).toBe('var(--mx-uc-1)');
  });
});

describe('userColorInk', () => {
  it('takes the hash colour of the theme the state wears, then steps it', () => {
    const id = '@aqua:gamecult.org';
    const n = indexColorMXID(id) - 1;
    expect(userColorInk(id, { state: 'dusk', phone: true })).toBe(
      inkForState(baked.noonday.userColors[n], { state: 'dusk', phone: true })
    );
    expect(userColorInk(id, { state: 'night', phone: false })).toBe(
      inkForState(baked.midnight.userColors[n], { state: 'night', phone: false })
    );
  });
});

describe('sceneInk: an explicit theme wins over the auto ink', () => {
  it('is the sky state and viewport only while the sky theme is worn and a scene runs', () => {
    // auto, scene on, no theme of the person's own: the sky theme is worn.
    expect(sceneInk(sceneThemeId('auto', 'dusk', true, false), true, 'dusk', true)).toEqual({
      state: 'dusk',
      phone: true,
    });
    // auto, but the person chose a theme: it wins, the theme's own ink stands.
    expect(sceneInk(sceneThemeId('auto', 'dusk', true, true), true, 'dusk', true)).toBeUndefined();
    // a fixed sky state is itself a choice and wins over the theme (skyTheme.ts), so its ink applies.
    expect(sceneInk(sceneThemeId('night', 'night', true, true), true, 'night', false)).toEqual({
      state: 'night',
      phone: false,
    });
    // no scene behind the page: nothing for the ink to be measured against.
    expect(
      sceneInk(sceneThemeId('auto', 'day', false, false), false, 'day', false)
    ).toBeUndefined();
    expect(sceneInk(sceneThemeId('day', 'day', true, false), false, 'day', false)).toBeUndefined();
  });
});

describe('labelInk', () => {
  it('differs from the theme only on a phone at dusk', () => {
    const states: FixedSkyState[] = ['day', 'dusk', 'night'];
    states.forEach((state) =>
      [false, true].forEach((phone) => {
        expect(labelInk({ state, phone })).toBe(state === 'dusk' && phone ? '#29221a' : undefined);
      })
    );
  });

  it('is the shipped dark ink, same hue and chroma, a little darker', () => {
    const dark = baked.noonday.tokens.Surface.OnContainer;
    const ink = labelInk({ state: 'dusk', phone: true }) as string;
    expect(dark).toBe('#342d25');
    expect(luminance(ink)).toBeLessThan(luminance(dark));
    expect(hueGap(dark, ink)).toBeLessThan(2);
  });
});

describe('noticeInk', () => {
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  it('is light enough to clear AA on the dark ridge wherever the theme ink does not', () => {
    (['day', 'dusk'] as FixedSkyState[]).forEach((state) => {
      const ink = noticeInk({ state, phone: true }) as string;
      expect(ratio(luminance(ink), NOTICE_GROUND)).toBeGreaterThanOrEqual(AA);
      // the dark theme ink it replaces does not
      expect(
        ratio(luminance(baked.noonday.tokens.SurfaceVariant.OnContainer), NOTICE_GROUND)
      ).toBeLessThan(AA);
    });
  });

  it('leaves night (already light) and every desktop state to the theme', () => {
    expect(noticeInk({ state: 'night', phone: true })).toBeUndefined();
    (['day', 'dusk', 'night'] as FixedSkyState[]).forEach((state) =>
      expect(noticeInk({ state, phone: false })).toBeUndefined()
    );
    expect(
      ratio(luminance(baked.midnight.tokens.SurfaceVariant.OnContainer), NOTICE_GROUND)
    ).toBeGreaterThanOrEqual(AA);
  });
});
