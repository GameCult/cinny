import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import { surfaceInk } from '../scene/sceneShell.css';
import { skyLabelInk } from '../scene/skyLabelInk';

export const CategoryButton = style({
  flexGrow: 1,
  '@media': {
    // A section heading on a phone is plain text: no pill behind it.
    'screen and (max-width: 750px)': {
      selectors: {
        '&&': {
          backgroundColor: 'transparent',
          boxShadow: 'none',
          border: 'none',
          borderRadius: 0,
        },
        ':root[data-scene] &&': {
          color: skyLabelInk('inherit'),
          textShadow: `0 0 3px ${surfaceInk}, 0 0 8px ${surfaceInk}`,
          filter: `drop-shadow(0 0 3px ${surfaceInk})`,
        },
      },
    },
  },
});
export const CategoryButtonIcon = style({
  opacity: config.opacity.P400,
});
