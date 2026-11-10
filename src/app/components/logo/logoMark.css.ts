import { globalStyle, style } from '@vanilla-extract/css';

/**
 * The Ratatoskr mark is white on transparent (Meta's matte). On any light theme (they all carry `prism-light`) a class
 * of this name darkens it to the dark ink; put it on every <img> that shows the mark on a themed surface. The favicon and
 * notification icons are files the browser draws and cannot take it.
 */
export const LogoMark = style({});
globalStyle(`body.prism-light .${LogoMark}`, { filter: 'brightness(0.18)' });
