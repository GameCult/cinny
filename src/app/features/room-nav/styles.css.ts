import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import { surfaceInk } from '../scene/sceneShell.css';
import { skyLabelInk } from '../scene/skyLabelInk';
import { NAV_ICON_REST_OPACITY } from '../../components/nav/styles.css';
import { PHONE_GLYPHS } from '../../../phoneGlyph.css';

export const CategoryButton = style({
  flexGrow: 1,
  gap: config.space.S200,
  selectors: {
    // Same left inset as a row's NavItemContent, so the chevron's gutter sits over the rows' gutters.
    '&&': { paddingLeft: config.space.S200 },
  },
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
  opacity: NAV_ICON_REST_OPACITY,
  // A phone draws the 16 px chevron as its IconButton neighbours are drawn (see phoneGlyph.css.ts): paint-time, so
  // the gutter and the row keep their layout.
  '@media': {
    'screen and (max-width: 750px)': {
      scale: `${PHONE_GLYPHS['50'].phonePx / PHONE_GLYPHS['50'].px}`,
    },
  },
});
