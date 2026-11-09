// The plate: the opaque surface text sits on wherever the shell is clear over the background
// scene and a sky state can make the sky behind it anything. It is the sign-in card's colour
// (--sky-bubble, set by the Midnight and Noonday themes in sky.css.ts), so what was checked for
// the card holds here. The other themes take these fallbacks.
export const SKY_PLATE_FALLBACK = {
  fill: '#0d1a26',
  text: '#b7c7d9',
  link: '#99c7ff',
} as const;
