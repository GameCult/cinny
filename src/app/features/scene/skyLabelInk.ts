/**
 * The sky's label ink (skyInk.ts `labelInk`), set on <html> by the theme manager (ThemeManager.tsx) only where it
 * differs from the theme's; unset, `skyLabelInk(fallback)` is the fallback, so a person's own theme keeps its ink.
 * Not in sceneShell.css.ts: vanilla-extract refuses a function exported from a .css.ts file.
 */
export const SKY_LABEL_INK = '--sky-label-ink';
export const skyLabelInk = (fallback: string) => `var(${SKY_LABEL_INK}, ${fallback})`;
