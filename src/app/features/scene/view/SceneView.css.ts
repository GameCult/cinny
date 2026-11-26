import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { PLATE_TINT, SKY_PLATE_FALLBACK } from '../skyPlate';
import { MOBILE_BREAKPOINT } from '../../../hooks/useScreenSize';

// The fullscreen scene view (sceneView.ts): the app is hidden behind it, so what is left over the scene is a turning surface and, top left, an icon rail and one
// panel. The rail and the panel are plates, blurred and tinted toward the sky like the chat bubbles (skyPlate.css.ts, PLATE_TINT), so their text reads over any sky.
const fill = `var(--sky-bubble, ${SKY_PLATE_FALLBACK.fill})`;
const text = `var(--sky-bubble-text, ${SKY_PLATE_FALLBACK.text})`;
const PHONE = `screen and (max-width: ${MOBILE_BREAKPOINT}px)`;
const GUTTER = 'max(0.5rem, env(safe-area-inset-top))';

export const Root = style({
  position: 'fixed',
  inset: 0,
});

/** The whole viewport: a drag, a wheel or a swipe on it turns the view. A touch is never the page's (there is none to scroll). */
export const Surface = style({
  position: 'absolute',
  inset: 0,
  touchAction: 'none',
  overscrollBehavior: 'none',
  userSelect: 'none',
  cursor: 'grab',
  selectors: { '&:active': { cursor: 'grabbing' } },
});

/** How much of the rail and the panel is left while a finger is down: they step out of the way of the turn (ruling ridge-view-phone-one-finger). */
export const TURNING_CHROME_OPACITY = 0.12;

/** The rail and the panel, top left. It takes no pointer itself, so a drag over its gaps turns the view; its plates do. It fades while a finger is down. */
export const Chrome = style({
  position: 'absolute',
  top: GUTTER,
  left: `max(0.5rem, env(safe-area-inset-left))`,
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S200,
  pointerEvents: 'none',
  transition: 'opacity 150ms',
  selectors: { [`${Root}[data-turning="true"] &`]: { opacity: TURNING_CHROME_OPACITY } },
});

const Plate = style({
  pointerEvents: 'auto',
  backgroundColor: [fill, `color-mix(in srgb, ${fill} ${PLATE_TINT * 100}%, transparent)`],
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  color: text,
  borderRadius: config.radii.R400,
  vars: {
    [color.Background.OnContainer]: text,
    [color.Surface.OnContainer]: text,
    [color.SurfaceVariant.OnContainer]: text,
  },
});

export const Rail = style([
  Plate,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    padding: config.space.S100,
  },
]);

export const Panel = style([
  Plate,
  {
    boxSizing: 'border-box',
    width: '22rem',
    maxWidth: 'calc(100vw - 5.5rem)',
    maxHeight: `calc(100dvh - 2 * ${GUTTER})`,
    overflowY: 'auto',
    padding: config.space.S300,
    '@media': { [PHONE]: { width: 'calc(100vw - 5.5rem)' } },
  },
]);

/** The Place submenu's carousel: the baked places side by side, one card centred, snapping as it is swiped; an arrow each side steps it. */
export const Carousel = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
});

export const Strip = style({
  position: 'relative',
  display: 'flex',
  flexGrow: 1,
  minWidth: 0,
  gap: config.space.S200,
  overflowX: 'auto',
  scrollSnapType: 'x mandatory',
  scrollbarWidth: 'none',
  overscrollBehaviorX: 'contain',
  selectors: { '&::-webkit-scrollbar': { display: 'none' } },
});

/** A place's card. Each is as wide as the strip, so the one in the strip is the one in view. */
export const PlaceCard = style({
  flex: '0 0 100%',
  scrollSnapAlign: 'center',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  padding: config.space.S300,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid currentColor`,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'center',
  cursor: 'pointer',
  opacity: 0.6,
  selectors: {
    '&[aria-current="true"]': { opacity: 1 },
  },
});
