import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { MessageBase, BubbleContent } from '../../components/message/layout/layout.css';
import { PageContent, PageNavContent } from '../../components/page/style.css';
import { Editor } from '../../components/editor/Editor.css';
import { MembersDrawer } from '../room/MembersDrawer.css';
import { CallStatus } from '../call-status/styles.css';
import { RoomViewFollowing } from '../room/RoomViewFollowing.css';
import { RoomViewTyping } from '../room/RoomViewTyping.css';
import { SKY_PLATE_FALLBACK } from './skyPlate';

// Over the scene (html[data-scene]) the signed-in shell is clear (sceneShell.css.ts), so text
// outside a chat bubble would sit on bare sky, which a sky state can make light, dark or both
// (dusk): no ink clears 4.5:1 on all of that (skyTheme.test.ts). Every such region is a plate
// instead, the sign-in card's opaque --sky-bubble fill, with its own ink and link, so what was
// checked for the card holds everywhere. One rule, below; a region joins it by class or by tag.
const scene = ':root[data-scene]';
const fill = `var(--sky-bubble, ${SKY_PLATE_FALLBACK.fill})`;
const text = `var(--sky-bubble-text, ${SKY_PLATE_FALLBACK.text})`;

/** A region with no class of its own (the room intro, the call view) joins the plate with this. */
export const SkyPlate = style({});

// A recipe's first class is its base style.
const base = (recipe: () => string) => `.${recipe().split(' ')[0]}`;

export const plateRegions = [
  `.${SkyPlate}`,
  // Title bars: the room header, the room list's header, every page header.
  '#root header',
  // The room list, and the pages that are lists (explore, inbox, search).
  `.${PageNavContent}`,
  `.${PageContent}`,
  // The composer, the members drawer, and the call status bar.
  `.${Editor}`,
  `.${MembersDrawer}`,
  `.${CallStatus}`,
  // The bars over the composer.
  `.${RoomViewTyping}`,
  base(RoomViewFollowing),
  // A message that is not a bubble (Modern, Compact) is plain text on the scene.
  `${base(MessageBase)}:not(:has(.${BubbleContent}))`,
];

// Only inside #root: menus and dialogs render in #portalContainer with their own themed fill.
const within = (ancestor: string) =>
  plateRegions.map((r) => `${ancestor} ${r.startsWith('#root') ? '' : '#root '}${r}`).join(', ');

globalStyle(within(scene), {
  backgroundColor: fill,
  color: text,
  // Themed ink was chosen for the clear shell; inside the plate every token reads the plate's.
  vars: {
    [color.Background.OnContainer]: text,
    [color.Surface.OnContainer]: text,
    [color.SurfaceVariant.OnContainer]: text,
  },
});
globalStyle(`${scene} #root header`, { borderRadius: config.radii.R400 });

// Links read against the plate. The Midnight and Noonday themes set their own --tc-link for it;
// the other themes take the fallback, as the sign-in card does.
globalStyle(within(`${scene} body:not(.gamecult-theme)`), {
  vars: { '--tc-link': SKY_PLATE_FALLBACK.link },
});

globalStyle(`${scene} #root .${SkyPlate}`, {
  borderRadius: config.radii.R400,
});
