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
 * footer ink is the plate's, so the tint has to bring the scene behind it to where that ink clears 4.5:1
 * (skyTheme.test.ts).
 */
export const FOOTER_TINT = 0.75;
