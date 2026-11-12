import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { MOBILE_BREAKPOINT } from '../../hooks/useScreenSize';

const PHONE = `screen and (max-width: ${MOBILE_BREAKPOINT}px)`;

/** Rows and booth side by side on wide screens. */
export const Layout = style({
  display: 'flex',
  gap: config.space.S500,
  alignItems: 'flex-start',
  '@media': { [PHONE]: { display: 'block', paddingBottom: toRem(120) } },
});

export const Rows = style({ flex: 1, minWidth: 0, margin: 0, padding: 0, listStyle: 'none' });

/** A hairline splits rows; it is the only chrome. */
export const Row = style({
  padding: `${config.space.S300} 0`,
  borderTop: `1px solid ${color.Background.ContainerLine}`,
});

export const Title = style({
  margin: 0,
  font: 'inherit',
  fontWeight: 600,
});

/** The fold button reads as the title itself, not as a control. */
export const Fold = style({
  all: 'unset',
  cursor: 'pointer',
  width: '100%',
  minHeight: 44,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  // A folded row says it can be opened: a chevron at the end, turned down while the row is open.
  selectors: {
    '&::after': {
      content: '"›"',
      flexShrink: 0,
      fontSize: '1.5em',
      lineHeight: 1,
      transition: 'transform 120ms',
    },
    '&[aria-expanded=true]::after': { transform: 'rotate(90deg)' },
  },
});

// Quiet lines (age, who it waits on, helper text) were measured at 4.5 over the day sky and 3.9-4.0 at dusk and night
// with the theme's 0.75 (taps2/desk-REPORT.md); 0.9 clears 4.5 in all three.
export const Quiet = style({ opacity: 0.9, margin: `${config.space.S100} 0` });
export const Body = style({ whiteSpace: 'pre-wrap', margin: `${config.space.S200} 0` });
export const Options = style({ margin: 0, padding: 0, listStyle: 'none' });
export const Option = style({ padding: `${config.space.S100} 0` });

export const Note = style({
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 44,
  margin: `${config.space.S200} 0`,
  font: 'inherit',
  color: 'inherit',
  background: 'none',
  // The note is disabled (slice 1). Its border is a UI boundary (3:1 wanted; the faint line under the 0.38 disabled
  // opacity measured 2.0), so it is drawn dashed in the full ink and not faded.
  border: '1px dashed currentColor',
});

/** Sticky beside the rows on wide screens; a small fixed corner image on phones. */
export const Booth = style({
  position: 'sticky',
  top: config.space.S400,
  width: toRem(168),
  flexShrink: 0,
  '@media': {
    [PHONE]: {
      position: 'fixed',
      top: 'auto',
      right: config.space.S200,
      bottom: config.space.S200,
      width: toRem(88),
    },
  },
});

// PoseAvatar's button is laid out for message gutters; the booth takes it back into flow.
globalStyle(`${Booth} > [data-pose]`, {
  position: 'static',
  float: 'none',
  display: 'block',
  width: '100%',
  height: 'auto',
  margin: 0,
  maskImage: 'none',
  WebkitMaskImage: 'none',
  cursor: 'default',
});

export const BoothLine = style({
  '@media': {
    // Still read out by the live region; only the picture shows in the corner.
    [PHONE]: {
      position: 'absolute',
      width: 1,
      height: 1,
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      whiteSpace: 'nowrap',
    },
  },
});

/** The recorded rulings sit on the dark ridge in every sky; they carry their own ground (scrimStyle). */
export const Recorded = style({
  marginTop: config.space.S400,
  padding: `${config.space.S200} ${config.space.S300}`,
});
