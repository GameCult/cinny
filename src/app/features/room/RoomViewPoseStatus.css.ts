import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const NARROW = 'screen and (max-width: 480px)';

export const StatusBlock = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    padding: `0 ${toRem(16)}`,
    // Phones: the newest mood and its "+N more" share one line.
    '@media': { [NARROW]: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' } },
  },
]);

// On phones only the newest mood shows until the strip is tapped; wide screens show every line.
export const StatusRow = style({
  '@media': {
    [NARROW]: {
      selectors: {
        '&[data-newest="false"]': { display: 'none' },
        [`${StatusBlock}[data-open="true"] &`]: { display: 'block', flexBasis: '100%' },
      },
    },
  },
});

export const StatusToggle = style([
  DefaultReset,
  {
    display: 'none',
    minHeight: toRem(24),
    padding: `0 ${config.space.S100}`,
    color: color.Primary.Main,
    cursor: 'pointer',
    '@media': { [NARROW]: { display: 'block' } },
  },
]);
