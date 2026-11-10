import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

// Phones: the read-receipt line is hidden; its slot shrinks to a margin under the composer.
const NARROW_HIDDEN = {
  height: toRem(8),
  minHeight: 0,
  overflow: 'hidden',
  visibility: 'hidden',
} as const;

export const RoomViewFollowingPlaceholder = style([
  DefaultReset,
  {
    height: toRem(28),
    '@media': { 'screen and (max-width: 480px)': NARROW_HIDDEN },
  },
]);

export const RoomViewFollowing = recipe({
  base: [
    DefaultReset,
    {
      minHeight: toRem(28),
      padding: `0 ${config.space.S400}`,
      width: '100%',
      backgroundColor: color.Surface.Container,
      color: color.Surface.OnContainer,
      outline: 'none',
      '@media': { 'screen and (max-width: 480px)': NARROW_HIDDEN },
    },
  ],
  variants: {
    clickable: {
      true: {
        cursor: 'pointer',
        selectors: {
          '&:hover, &:focus-visible': {
            color: color.Primary.Main,
          },
          '&:active': {
            color: color.Primary.Main,
          },
        },
      },
    },
  },
});
