import { describe, expect, it, vi } from 'vitest';
import { atStandardTime } from './standardTime.testkit';
import { baked } from '../../../sky/baked';
import { AA, contrast } from '../../../sky/skyTokens.js';
import { Editor } from '../../components/editor/Editor.css';
import { PageContent, PageNavContent } from '../../components/page/style.css';
import { CallStatus } from '../call-status/styles.css';
import { MembersDrawer } from '../room/MembersDrawer.css';
import { RoomViewTyping } from '../room/RoomViewTyping.css';
import { FOOTER_TINT, SKY_PLATE_FALLBACK } from './skyPlate';
import { SkyPlate, plateRegions } from './skyPlate.css';
import {
  getResolvedSkyState,
  setSkyClock,
  subscribe as subscribeSky,
} from './skyState';
import { sceneThemeId, skyThemeId } from './skyTheme';

const SKY = { 'midnight-sky': baked.midnight, 'noonday-sky': baked.noonday } as const;
const r2 = (n: number) => n.toFixed(2);
const fixed = (['day', 'dusk', 'night'] as const).flatMap((s) => {
  const id = skyThemeId(s);
  return id ? [[s, id] as const] : [];
});

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

  describe('sceneThemeId, the theme the page wears', () => {
    it('a fixed state picks its theme, whatever the scene, while the person chose no theme', () => {
      [true, false].forEach((scene) => {
        expect(sceneThemeId('day', 'night', scene, false)).toBe('noonday-sky');
        expect(sceneThemeId('night', 'day', scene, false)).toBe('midnight-sky');
      });
    });

    it('a theme the person chose wins over every sky state, fixed or auto', () => {
      (['auto', 'day', 'dusk', 'night'] as const).forEach((state) =>
        [true, false].forEach((scene) =>
          expect(sceneThemeId(state, 'night', scene, true)).toBeUndefined()
        )
      );
    });

    it('auto follows the resolved sky only while a scene is on and the person chose no theme', () => {
      expect(sceneThemeId('auto', 'day', true, false)).toBe('noonday-sky');
      expect(sceneThemeId('auto', 'dusk', true, false)).toBe('noonday-sky');
      expect(sceneThemeId('auto', 'night', true, false)).toBe('midnight-sky');
      expect(sceneThemeId('auto', 'day', false, false)).toBeUndefined();
      expect(sceneThemeId('auto', 'day', true, true)).toBeUndefined();
    });
  });

  it('the resolved sky a hook subscribes to changes as the clock crosses, so theme classes follow', () => {
    vi.useFakeTimers();
    let hour = 12;
    setSkyClock(() => atStandardTime(hour, 10));
    const seen: string[] = [];
    const off = subscribeSky((s) => seen.push(s));
    expect(getResolvedSkyState()).toBe('day');
    hour = 0;
    setSkyClock(() => atStandardTime(hour, 10));
    vi.advanceTimersByTime(61_000);
    expect(seen).toEqual(['night']);
    expect(getResolvedSkyState()).toBe('night');
    off();
    vi.useRealTimers();
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

describe('the plate, where text cannot rest on bare sky', () => {
  // Each theme's plate: fill, ink, link and the WCAG ratios of ink and link on the fill.
  const plates = [
    ['midnight-sky', baked.midnight, '12.17', '11.28'],
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

  it('plates the composer, the call status bar and the call view', () => {
    on(`.${Editor}`);
    on(`.${CallStatus}`);
    on(`.${SkyPlate}`);
  });

  it('plates a message that is not a bubble, and nothing else of the signed-in shell', () => {
    expect(plateRegions.some((r) => r.includes(':not(:has('))).toBe(true);
    expect(plateRegions).toHaveLength(4);
  });

  // Meta, 2026-11-09: no chrome. These are bare ink on the sky, not plates.
  it('leaves title bars, the room list, list pages, the drawer and the bars over the composer bare', () => {
    [
      `.${MembersDrawer}`,
      `.${PageNavContent}`,
      `.${PageContent}`,
      `.${RoomViewTyping}`,
      '#root header',
    ].forEach((cls) => expect(plateRegions).not.toContain(cls));
  });
});

describe('the sign-in footer band', () => {
  // The footer line is the plate's ink on a band that mixes FOOTER_TINT of the plate's fill over the blurred scene,
  // as the browser does: per channel, in encoded sRGB (not in linear light, which flatters dark scenes). The scene
  // behind it is the scene, taken as grey: as dark as 0 or as light as 1 (a sky's range is whatever the look draws). Ink
  // contrast is lowest at one of those two ends, so both are checked.
  const encode = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hexOf = (c: number[]) =>
    `#${c
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;
  const bandOver = (fill: string, behind: number) =>
    hexOf(channels(fill).map((f) => FOOTER_TINT * f + (1 - FOOTER_TINT) * encode(behind)));
  it.each(fixed)(
    '%s: the ink clears AA over the darkest and the lightest scene behind it',
    (state, id) => {
      const { Other, OtherText } = SKY[id].bubbles;
      [0, 1].forEach((behind) => {
        expect(contrast(OtherText, bandOver(Other, behind))).toBeGreaterThanOrEqual(AA);
      });
    }
  );
});
