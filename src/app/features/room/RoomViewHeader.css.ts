import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import { MOBILE_BREAKPOINT } from '../../hooks/useScreenSize';

// Phone tap target: the topic is an 18 px line under the room name; its button grows 9 px up and 17 px down
// (44 px to tap; more below because the name is above) and the negative margin keeps the layout where it was.
export const HeaderTopic = style({
  '@media': {
    [`screen and (max-width: ${MOBILE_BREAKPOINT}px)`]: {
      paddingTop: 9,
      paddingBottom: 17,
      marginTop: -9,
      marginBottom: -17,
    },
  },
  ':hover': {
    cursor: 'pointer',
    opacity: config.opacity.P500,
    textDecoration: 'underline',
  },
});
