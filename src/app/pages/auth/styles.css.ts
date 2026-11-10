import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { FOOTER_TINT, PLATE_TINT } from '../../features/scene/skyPlate';

export const AuthLayout = style({
  minHeight: '100%',
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
  padding: config.space.S400,
  paddingRight: config.space.S200,
  paddingBottom: 0,
  position: 'relative',
});

export const AuthCard = style({
  marginTop: '1vh',
  maxWidth: toRem(460),
  width: '100%',
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  borderRadius: config.radii.R400,
  boxShadow: config.shadow.E100,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  overflow: 'hidden',
});

export const AuthLogo = style([
  DefaultReset,
  {
    width: toRem(32),
    height: toRem(32),

    borderRadius: '50%',
  },
]);

// The mark is white (Meta's matte); on the light sky theme it takes the dark ink instead.
globalStyle('body.noonday-sky img[src*="ratatoskr"]', { filter: 'brightness(0.18)' });

export const AuthHeader = style({
  padding: `0 ${config.space.S400}`,
  borderBottomWidth: config.borderWidth.B300,
});

export const AuthCardContent = style({
  maxWidth: toRem(402),
  width: '100%',
  margin: 'auto',
  padding: config.space.S400,
  paddingTop: config.space.S700,
  paddingBottom: toRem(44),
  gap: toRem(44),
});

export const AuthFooter = style({
  padding: config.space.S200,
});

// While the background scene runs (html[data-scene], set by features/scene/BackgroundScene), the
// signed-out ground is clear and the card is a pane shaped like a message bubble (BubbleContent:
// radius R500, no border), filled with the sky's bubble colour. The scene is one fixed dusk for
// every theme, so the card is opaque: its text and link contrast cannot depend on what the scene
// shows behind it, nor on a blur. The --sky-bubble variables come from the sky themes (Midnight and
// Noonday); the other themes (Light, Silver, Dark, Butter) take the fallback colours.
// WCAG ratios of text / Register link on the card, per theme:
//   Light, Silver, Dark, Butter  #b7c7d9 / #99c7ff on #0d1a26   10.21 / 10.03
//   Midnight Sky                 #aeccff / #8ad1bd on #0a090e   12.17 / 11.28
//   Noonday Sky                  #342d25 / #2a4f27 on #b9b6af    6.70 /  4.62
// The fallback link is set here because those themes' own links (Light 2.49:1, Silver 2.49:1) are
// made for their own grounds, not this card; Dark and Butter already use the same hsl(213 100% 80%).
// The card is also made shorter so it leaves more of the scene visible on a phone.
const scene = ':root[data-scene]';
const tint = `color-mix(in srgb, var(--sky-bubble, #0d1a26) ${FOOTER_TINT * 100}%, transparent)`;
globalStyle(`${scene} ${AuthLayout}`, {
  backgroundColor: 'transparent',
  backgroundImage: 'none',
});
globalStyle(`${scene} ${AuthCard}`, {
  // Meta, 2026-11-09: no chrome; where readability needs help, the chat-bubble treatment (blur with a tint toward the
  // background), and if that is not enough the fix goes in the background, not in a plate. Same tint as the footer band.
  backgroundColor: [
    'var(--sky-bubble, #0d1a26)',
    `color-mix(in srgb, var(--sky-bubble, #0d1a26) ${PLATE_TINT * 100}%, transparent)`,
  ],
  backdropFilter: 'blur(12px)',
  color: 'var(--sky-bubble-text, #b7c7d9)',
  borderRadius: config.radii.R500,
  border: 'none',
  boxShadow: 'none',
});
globalStyle(`${scene} body:not(.gamecult-theme) ${AuthCard}`, {
  vars: { '--tc-link': '#99c7ff' },
});
globalStyle(`${scene} ${AuthHeader}`, {
  backgroundColor: 'transparent',
  borderBottomWidth: 0,
  boxShadow: 'none',
});
globalStyle(`${scene} #root header.${AuthHeader}`, {
  backgroundColor: 'transparent',
  backdropFilter: 'none',
});
globalStyle(`${scene} ${AuthCardContent}`, {
  paddingTop: config.space.S500,
  paddingBottom: config.space.S400,
  gap: config.space.S500,
});

// The footer line sits on the terrain, which is dark at its foot in every sky (luminance 0.02 at dusk), where the
// sky's dark ink is unreadable. Over the scene it gets a blurred band tinted with the plate's fill and the plate's
// ink, faded out at its edges so it reads as haze and not as a bar: the scene shows through and round it. A browser
// without color-mix gets the plate's opaque fill, as the chat bubbles do (message/layout/layout.css.ts). The tint
// (FOOTER_TINT) is checked against the ink in skyTheme.test.ts, the emitted rule in footerBand.test.ts.
const FADE_Y =
  'linear-gradient(to bottom, transparent, #000 16px, #000 calc(100% - 16px), transparent)';
const FADE_X =
  'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)';
globalStyle(`${scene} ${AuthFooter}`, {
  paddingTop: config.space.S500,
  paddingBottom: config.space.S500,
  backgroundColor: ['var(--sky-bubble, #0d1a26)', tint],
  backdropFilter: 'blur(12px)',
  maskImage: `${FADE_Y}, ${FADE_X}`,
  maskComposite: 'intersect',
  color: 'var(--sky-bubble-text, #b7c7d9)',
});
globalStyle(`${scene} ${AuthFooter} a`, {
  color: 'var(--sky-bubble-text, #b7c7d9)',
});
