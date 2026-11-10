import { globalStyle } from '@vanilla-extract/css';

// Meta, 2026-11-10: "buttons are big and ugly, too, they don't need chrome either". Over the scene a folds Button or
// Chip is its label in the page's ink, with a faint wash on hover and focus. Menus and dialogs (#portalContainer) keep
// folds' look. The selectors are folds' hashed recipe base classes (Button epr39zd, Chip _1bv8u1w6).
const scene = ':root[data-scene] #root';
const controls = [`${scene} .epr39zd`, `${scene} ._1bv8u1w6`].join(', ');
globalStyle(controls, {
  backgroundColor: 'transparent',
  boxShadow: 'none',
  border: 'none',
  outline: 'none',
  color: 'inherit',
});
globalStyle(
  [
    `${scene} .epr39zd:hover`,
    `${scene} .epr39zd:focus-visible`,
    `${scene} ._1bv8u1w6:hover`,
    `${scene} ._1bv8u1w6:focus-visible`,
  ].join(', '),
  { backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)' }
);
globalStyle(`${scene} .epr39zd`, {
  fontWeight: 700,
  textDecoration: 'underline',
  textUnderlineOffset: '0.25em',
});
