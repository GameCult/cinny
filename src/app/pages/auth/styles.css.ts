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
// signed-out ground is clear and the card is a translucent, blurred pane shaped like a message
// bubble (BubbleContent: radius R500, no border), filled with the sky's bubble colour. The
// --sky-bubble variables come from the sky theme (PR #22); the plain colours are the fallback
// until it lands. 85% fill keeps text >= 4.5:1 over the scene's brightest and darkest backdrops.
// The card is also made shorter so it leaves more of the scene visible on a phone.
const scene = ':root[data-scene]';
globalStyle(`${scene} ${AuthLayout}`, {
  backgroundColor: 'transparent',
  backgroundImage: 'none',
});
globalStyle(`${scene} ${AuthCard}`, {
  backgroundColor: [
    'rgba(13, 26, 38, 0.85)',
    'color-mix(in srgb, var(--sky-bubble, #0d1a26) 85%, transparent)',
  ],
  color: 'var(--sky-bubble-text, #b7c7d9)',
  borderRadius: config.radii.R500,
  borderColor: 'transparent',
  backdropFilter: 'blur(12px)',
});
globalStyle(`${scene} ${AuthHeader}`, {
  backgroundColor: 'transparent',
});
globalStyle(`${scene} ${AuthCardContent}`, {
  paddingTop: config.space.S500,
  paddingBottom: config.space.S400,
  gap: config.space.S500,
});
