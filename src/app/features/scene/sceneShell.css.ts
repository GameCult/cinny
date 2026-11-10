import { createVar, fallbackVar, globalStyle } from '@vanilla-extract/css';
import { color } from 'folds';

// While the background scene runs (html[data-scene], set by BackgroundScene) the signed-in shell
// leaves the ridge visible behind the whole app: the page, header, sidebar and room surfaces are
// clear, with only a faint wash for hover and press. Chat bubbles (message/layout/layout.css.ts)
// and the composer (editor/Editor.css.ts) are the filled surfaces. The tokens are redefined on
// #root only, so everything that renders into #portalContainer (menus, dialogs, tooltips,
// popouts) keeps its themed fill: that is the sparse menu chrome.
const wash = (pct: number) => `color-mix(in srgb, currentColor ${pct}%, transparent)`;

globalStyle(':root[data-scene] #root', {
  vars: {
    [color.Background.Container]: 'transparent',
    [color.Background.ContainerHover]: wash(8),
    [color.Background.ContainerActive]: wash(12),
    [color.Background.ContainerLine]: wash(14),
    [color.Surface.Container]: 'transparent',
    [color.Surface.ContainerHover]: wash(8),
    [color.Surface.ContainerActive]: wash(12),
    [color.Surface.ContainerLine]: wash(14),
  },
});

// The themed surface colour as text on a coloured ground (avatar initials) must survive the clear
// shell above. It is captured on <body>, above the #root override, and read back with its themed
// fallback when no scene runs.
const surfaceInkVar = createVar();
globalStyle(':root[data-scene] body', { vars: { [surfaceInkVar]: color.Surface.Container } });
export const surfaceInk = fallbackVar(surfaceInkVar, color.Surface.Container);
