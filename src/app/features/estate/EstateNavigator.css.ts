import { globalStyle, style } from '@vanilla-extract/css';
import { MOBILE_BREAKPOINT } from '../../hooks/useScreenSize';

/** On phones every control inside the navigator is at least 44 px square to tap. */
export const Targets = style({});

globalStyle(`${Targets} button, ${Targets} a`, {
  '@media': {
    [`screen and (max-width: ${MOBILE_BREAKPOINT}px)`]: {
      minHeight: 44,
      minWidth: 44,
    },
  },
});
