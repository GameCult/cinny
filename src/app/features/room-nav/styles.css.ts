import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import { NAV_ICON_REST_OPACITY } from '../../components/nav/styles.css';

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
      },
    },
  },
});
export const CategoryButtonIcon = style({
  opacity: NAV_ICON_REST_OPACITY,
});
