import { globalStyle } from '@vanilla-extract/css';
import { config } from 'folds';
import { SKY_VARIANTS, skyGradientCss } from './skyPalette';

// Softer, rounder shape language and an airier line height. Scoped to the sky theme
// class so the stock themes keep folds' defaults.
globalStyle('body.sky-theme', {
  vars: {
    [config.radii.R300]: '10px',
    [config.radii.R400]: '16px',
    [config.radii.R500]: '22px',
    [config.lineHeight.T300]: '1.6',
    [config.lineHeight.T400]: '1.7',
    [config.lineHeight.T500]: '1.7',
    [config.lineHeight.B400]: '1.6',
    [config.lineHeight.B500]: '1.6',
    [config.lineHeight.D400]: '1.7',
  },
});

// One fixed layer carries the sky. Panels are translucent tints over it (skyPalette.ts);
// nothing else paints a gradient, and no message does.
globalStyle('body.sky-theme::before', {
  content: '""',
  position: 'fixed',
  inset: 0,
  zIndex: -1,
  pointerEvents: 'none',
});

SKY_VARIANTS.forEach((v) => {
  const top = v.gradient[0][1];
  globalStyle(`body.${v.id}`, {
    backgroundColor: top, // solid fallback until the layer paints
    colorScheme: v.kind,
  });
  globalStyle(`body.${v.id}::before`, { background: skyGradientCss(v) });
  globalStyle(`body.${v.id} ::selection`, {
    backgroundColor: v.leaf,
    color: v.kind === 'dark' ? '#10270f' : '#ffffff',
  });
  globalStyle(`body.${v.id}`, {
    vars: {
      '--tc-link': v.link,
      ...Object.fromEntries(v.userColors.map((c, i) => [`--mx-uc-${i + 1}`, c])),
    },
  });
});
