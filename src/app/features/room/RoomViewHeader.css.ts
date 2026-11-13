import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import { MOBILE_BREAKPOINT } from '../../hooks/useScreenSize';

// Phone tap target: the topic is an 18 px line directly under the room name (no gap), so its button grows only
// downward, 26 px (44 px to tap) and the negative margin keeps the layout where it was: growing up would take taps
// from the name line.
export const HeaderTopic = style({
  '@media': {
    [`screen and (max-width: ${MOBILE_BREAKPOINT}px)`]: {
      paddingBottom: 26,
      marginBottom: -26,
    },
  },
  ':hover': {
    cursor: 'pointer',
    opacity: config.opacity.P500,
    textDecoration: 'underline',
  },
});
