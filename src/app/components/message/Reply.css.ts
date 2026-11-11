import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

export const ReplyBend = style({
  flexShrink: 0,
});

export const ThreadIndicator = style({
  opacity: config.opacity.P300,

  selectors: {
    'button&': {
      cursor: 'pointer',
    },
    ':hover&': {
      opacity: config.opacity.P500,
    },
  },
});

export const Reply = style({
  marginBottom: toRem(1),
  minWidth: 0,
  maxWidth: '100%',
  minHeight: config.lineHeight.T300,
  selectors: {
    'button&': {
      cursor: 'pointer',
    },
  },
});

export const ReplyContent = style({
  minWidth: 0,
  opacity: config.opacity.P300,

  selectors: {
    [`${Reply}:hover &`]: {
      opacity: config.opacity.P500,
    },
  },
});

export const ReplyText = style({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  minWidth: 0,
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
});

export const ReplyWrap = style({
  minWidth: 0,
  maxWidth: '100%',
});
