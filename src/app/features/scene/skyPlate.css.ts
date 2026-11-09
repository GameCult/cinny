import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';
import { MessageBase, BubbleContent } from '../../components/message/layout/layout.css';
import { SKY_PLATE_FALLBACK } from './skyPlate';

// Over the scene (html[data-scene]) the signed-in shell is clear, so text outside a chat bubble
// would sit on bare sky, which a sky state can make light, dark or both (dusk): no ink clears
// 4.5:1 on all of that (skyTheme.test.ts). Such text gets a plate instead, never a halo.
const scene = ':root[data-scene]';
const fill = `var(--sky-bubble, ${SKY_PLATE_FALLBACK.fill})`;
const text = `var(--sky-bubble-text, ${SKY_PLATE_FALLBACK.text})`;

const plate = {
  backgroundColor: fill,
  color: text,
  borderRadius: config.radii.R400,
} as const;

/** A title-bar group whose controls and title sit on the plate. */
export const SkyPlate = style({});
globalStyle(`${scene} ${SkyPlate}`, { ...plate, padding: `0 ${config.space.S100}` });
// Controls in the plate take its ink; their themed ink was chosen for the clear shell.
globalStyle(`${scene} ${SkyPlate} button`, { color: 'inherit' });

// A message that is not a bubble (Modern, Compact) is plain text on the scene: plate the row.
globalStyle(`${scene} ${MessageBase}:not(:has(.${BubbleContent}))`, plate);

// Links on a plate read against the plate. The Midnight and Noonday themes set their own
// --tc-link for it; the rest take the fallback, as the sign-in card does.
globalStyle(`${scene} body:not(.gamecult-theme) ${SkyPlate}, ${scene} body:not(.gamecult-theme) ${MessageBase}`, {
  vars: { '--tc-link': SKY_PLATE_FALLBACK.link },
});
