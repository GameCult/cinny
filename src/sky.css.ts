import { globalStyle } from '@vanilla-extract/css';
import { baked } from './sky/baked';

// Fallback background and the colours folds has no token for. Everything is read from
// the bake (albedo x irradiance via sun.js); nothing here chooses a colour.
const skies = [
  { scope: 'body.midnight-sky', sky: baked.midnight, scheme: 'dark' },
  { scope: 'body.noonday-sky', sky: baked.noonday, scheme: 'light' },
] as const;

skies.forEach(({ scope, sky, scheme }) => {
  const stops = sky.gradient.map(
    (c, i) => `${c} ${Math.round((i / (sky.gradient.length - 1)) * 100)}%`
  );
  globalStyle(scope, {
    colorScheme: scheme,
    backgroundColor: sky.gradient[0],
    backgroundImage: `linear-gradient(180deg, ${stops.join(', ')})`,
    backgroundAttachment: 'fixed',
    vars: {
      '--tc-link': sky.link,
      ...Object.fromEntries(sky.userColors.map((c, i) => [`--mx-uc-${i + 1}`, c])),
      '--sky-bubble': sky.bubbles.Other,
      '--sky-bubble-text': sky.bubbles.OtherText,
      '--sky-bubble-own': sky.bubbles.Own,
      '--sky-bubble-own-text': sky.bubbles.OwnText,
    },
  });
});
