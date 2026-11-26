import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { atSolarTime } from './ridge/skyTestkit';
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
  setSkyPlace,
  subscribe as subscribeSky,
} from './skyState';
import { sceneThemeId } from './skyTheme';
import { FALLBACK_VIEW } from './ridge/view';

beforeAll(() => setSkyPlace(FALLBACK_VIEW.place));
afterAll(() => setSkyPlace(undefined));

const SKY = { 'midnight-sky': baked.midnight, 'noonday-sky': baked.noonday } as const;
const r2 = (n: number) => n.toFixed(2);
const fixed = (['day', 'dusk', 'night'] as const).flatMap((st) => {
  const id = sceneThemeId(st, true);
  return id ? [[st, id] as const] : [];
});

describe('sceneThemeId, the theme the page wears', () => {
  it('with a scene on, the drawn sky gives its theme, whatever theme a person stored', () => {
    expect(sceneThemeId('day', true)).toBe('noonday-sky');
    expect(sceneThemeId('dusk', true)).toBe('noonday-sky');
    expect(sceneThemeId('night', true)).toBe('midnight-sky');
  });

  it('auto draws the clock sky and that sky decides', () => {
    [0, 12, 23].forEach((h) => {
      setSkyClock(() => atSolarTime(h, 10));
      expect(sceneThemeId(getResolvedSkyState(), true)).toBe(
        h === 12 ? 'noonday-sky' : 'midnight-sky'
      );
    });
    setSkyClock();
  });

  it('with no place known there is no drawn sky to follow: the theme is not decided', () => {
    setSkyPlace(undefined);
    expect(getResolvedSkyState()).toBeUndefined();
    expect(sceneThemeId(getResolvedSkyState(), true)).toBeUndefined();
    setSkyPlace(FALLBACK_VIEW.place);
  });

  it('with the scene off no sky is drawn, so the person theme stands', () => {
    (['day', 'dusk', 'night'] as const).forEach((st) =>
      expect(sceneThemeId(st, false)).toBeUndefined()
    );
  });

  it('the resolved sky a hook subscribes to changes as the clock crosses, so theme classes follow', () => {
    vi.useFakeTimers();
    let hour = 12;
    setSkyClock(() => atSolarTime(hour, 10));
    const seen: Array<string | undefined> = [];
    const off = subscribeSky((s) => seen.push(s));
    expect(getResolvedSkyState()).toBe('day');
    hour = 0;
    setSkyClock(() => atSolarTime(hour, 10));
    vi.advanceTimersByTime(61_000);
    expect(seen).toEqual(['night']);
    expect(getResolvedSkyState()).toBe('night');
    off();
    vi.useRealTimers();
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
