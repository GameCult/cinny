import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { MOBILE_BREAKPOINT } from '../../hooks/useScreenSize';

const WIDE = `screen and (min-width: ${MOBILE_BREAKPOINT + 1}px)`;

/** One column, bare ink on the scene. */
export const Column = style({
  maxWidth: toRem(720),
  width: '100%',
  margin: '0 auto',
  padding: config.space.S400,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});

/** A tappable text row: no border, no fill, at least 44 px tall. */
export const Row = style({
  all: 'unset',
  boxSizing: 'border-box',
  cursor: 'pointer',
  minHeight: 44,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: toRem(2),
  color: color.Background.OnContainer,
  ':focus-visible': { textDecoration: 'underline' },
});

export const Back = style([Row, { minHeight: 44 }]);

export const Files = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S400,
});

/** Images may tile into a grid on wide screens only. */
export const FilesWide = style({
  '@media': {
    [WIDE]: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      alignItems: 'start',
    },
  },
});

export const Dim = style({ opacity: config.opacity.P300 });
