// The plate: the opaque surface text sits on wherever the shell is clear over the background
// scene and a sky state can make the sky behind it anything. It is the sign-in card's colour
// (--sky-bubble, set by the Midnight and Noonday themes in sky.css.ts), so what was checked for
// the card holds here. The other themes take these fallbacks.
export const SKY_PLATE_FALLBACK = {
  fill: '#0d1a26',
  text: '#b7c7d9',
  link: '#99c7ff',
} as const;

/**
 * The sign-in footer's tint: how much of the plate's fill (--sky-bubble) is mixed over the blurred scene behind the
 * footer line. The footer is a blurred, tinted band with soft edges, not a plate: the scene shows through it. The
 * footer ink is the plate's, so the tint has to bring the scene behind it to where that ink clears 4.5:1. The browser
 * mixes in sRGB, so the test does too (skyTheme.test.ts): over pure black 0.80 gives 4.36 and 0.82 gives 4.55. The
 * terrain is not black: in the shots at 390x844 (terrain scene, tier low) the darkest pixel in the footer's region is
 * 0.0203 at Dusk, 0.0936 at Day (dark ink) and 0.0052 at Night (light ink). Measured on the drawn pixels with the band
 * on, the worst link contrast is 5.0 at Dusk, 5.7 at Day and 11.2 at Night.
 */
export const FOOTER_TINT = 0.82;

/**
 * How much of the plate's fill (--sky-bubble) is mixed over the blurred scene behind a plate (title bars, lists, the
 * composer, the sign-in card). Meta, 2026-11-09: "The app shouldn't need chrome, and where it does help for readability it
 * should be like the chat bubbles, blur with a bit of tint towards the background color. If that's not working, the fix
 * is in the background, not covering it up."
 */
export const PLATE_TINT = 0.45;
