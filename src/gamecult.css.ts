import { globalStyle } from '@vanilla-extract/css';
import { config } from 'folds';

// Softer, rounder shape language and an airier line height. Scoped to the GameCult
// theme class so the stock themes keep folds' defaults.
const scope = 'body.gamecult-theme';

globalStyle(scope, {
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

// Nunito for the GameCult look (the three-doors mock-up); the stock themes keep Inter.
globalStyle(scope, {
  fontFamily: "'Nunito Variable', var(--font-secondary)",
});
