import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

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
    width: toRem(26),
    height: toRem(26),

    borderRadius: '50%',
  },
]);

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
//   Midnight Sky                 #aeccff / #609385 on #0a090e   12.17 /  5.68
//   Noonday Sky                  #342d25 / #2a4f27 on #b9b6af    6.70 /  4.62
// The fallback link is set here because those themes' own links (Light 2.49:1, Silver 2.49:1) are
// made for their own grounds, not this card; Dark and Butter already use the same hsl(213 100% 80%).
// The card is also made shorter so it leaves more of the scene visible on a phone.
const scene = ':root[data-scene]';
globalStyle(`${scene} ${AuthLayout}`, {
  backgroundColor: 'transparent',
  backgroundImage: 'none',
});
globalStyle(`${scene} ${AuthCard}`, {
  backgroundColor: 'var(--sky-bubble, #0d1a26)',
  color: 'var(--sky-bubble-text, #b7c7d9)',
  borderRadius: config.radii.R500,
  // A faint inner edge, so a pane this clear still reads as a surface.
  borderColor: 'rgba(183, 199, 217, 0.14)',
});
globalStyle(`${scene} body:not(.gamecult-theme) ${AuthCard}`, {
  vars: { '--tc-link': '#99c7ff' },
});
globalStyle(`${scene} ${AuthHeader}`, {
  backgroundColor: 'transparent',
});
globalStyle(`${scene} ${AuthCardContent}`, {
  paddingTop: config.space.S500,
  paddingBottom: config.space.S400,
  gap: config.space.S500,
});
