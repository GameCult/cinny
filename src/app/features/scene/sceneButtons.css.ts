import { globalStyle } from '@vanilla-extract/css';

// Meta, 2026-11-10: "buttons are big and ugly, too, they don't need chrome either". Over the scene a folds Button or
// Chip is its label in the page's ink, with a faint wash on hover and focus. Menus and dialogs (#portalContainer) keep
// folds' look. The selectors are folds' hashed recipe base classes (Button, Chip; pinned below).
// sceneButtons.test.ts resolves both from the installed folds and fails when a folds upgrade rehashes them.
export const FOLDS_BUTTON_CLASS = 'epr39zd';
export const FOLDS_CHIP_CLASS = '_1bv8u1w6';
const scene = ':root[data-scene] #root';
const btn = `${scene} .${FOLDS_BUTTON_CLASS}`;
const chip = `${scene} .${FOLDS_CHIP_CLASS}`;
const controls = [btn, chip].join(', ');
globalStyle(controls, {
  backgroundColor: 'transparent',
  boxShadow: 'none',
  border: 'none',
  color: 'inherit',
});
globalStyle(
  [`${btn}:hover`, `${btn}:focus-visible`, `${chip}:hover`, `${chip}:focus-visible`].join(', '),
  { backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)' }
);
// A visible keyboard focus ring in the control's own ink, on top of the hover wash.
globalStyle([`${btn}:focus-visible`, `${chip}:focus-visible`].join(', '), {
  outline: '2px solid currentColor',
  outlineOffset: '2px',
});
globalStyle(btn, {
  fontWeight: 700,
  textDecoration: 'underline',
  textUnderlineOffset: '0.25em',
});
