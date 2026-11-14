import { globalStyle } from '@vanilla-extract/css';
import { MOBILE_BREAKPOINT } from './app/hooks/useScreenSize';

// Phone glyph size. On a phone the glyph inside an IconButton is drawn larger, by `scale` (a paint-time transform:
// the button's box, its PhoneHit area and every row of buttons keep the layout they have, so nothing reflows at
// 320 px). folds draws a glyph at one of its Icon sizes and the IconButton's box is padding plus that glyph, so the
// factor is chosen per Icon size. Desktop is not touched.
//
// The class names are folds 2.7.2's own (the Icon size classes and the IconButton base class); phoneGlyph.test.ts
// reads them back from folds' dist, so a folds upgrade that renames them fails there instead of silently here.
export const ICON_BUTTON_CLASS = 'brs7ce5';
/** folds Icon size -> [its class, its px, the px it is drawn at on a phone]. The 24 px glyph is the folds default and
 * reads small in a 40 px button, so it grows too; 28 px and up are already large. */
export const PHONE_GLYPHS = {
  '50': { cls: 'cpipac7', px: 16, phonePx: 22 },
  '100': { cls: 'cpipac8', px: 18, phonePx: 24 },
  '200': { cls: 'cpipac9', px: 20, phonePx: 24 },
  '300': { cls: 'cpipaca', px: 22, phonePx: 26 },
  '400': { cls: 'cpipacb', px: 24, phonePx: 28 },
} as const;

const PHONE = `screen and (max-width: ${MOBILE_BREAKPOINT}px)`;

Object.values(PHONE_GLYPHS).forEach(({ cls, px, phonePx }) =>
  globalStyle(`.${ICON_BUTTON_CLASS} > .${cls}`, {
    '@media': { [PHONE]: { scale: `${phonePx / px}` } },
  })
);
