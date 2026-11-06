// The sky palette: three themes (dawn, day, dusk-night) whose background is one fixed sky
// gradient and whose elements (buttons, accents, links, borders, selection) are Yggdrasil
// greens and bark/root browns. This module is the only place a sky colour is chosen;
// colors.css.ts, sky.css.ts, the manifest and skyPalette.test.ts all read it. The test pins WCAG AA
// for text against every translucent panel over every point of the gradient.

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];
export type SkyKind = 'light' | 'dark';
export type SkyStop = readonly [position: number, color: string];

export type SkyVariant = {
  id: string;
  name: string;
  kind: SkyKind;
  gradient: readonly SkyStop[];
  ink: string; // message text
  panel: string; // Background panel tint, Surface and SurfaceVariant derive from it
  panelAlpha: readonly [background: number, surface: number, variant: number];
  leaf: string; // Yggdrasil green: Primary
  bark: string; // bark/root brown: Secondary
  link: string;
  userColors: readonly string[];
};

export const hex = (c: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as unknown as Rgb;
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
export const rgba = (c: Rgb, a: number) =>
  `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${a})`;

export const SKY_VARIANTS: readonly SkyVariant[] = [
  {
    id: 'sky-dawn',
    name: 'Dawn',
    kind: 'light',
    gradient: [
      [0, '#5b4a8a'],
      [38, '#c9729a'],
      [72, '#f4a77a'],
      [100, '#fbe0a8'],
    ],
    ink: '#2b1d14',
    panel: '#fff6ec',
    panelAlpha: [0.68, 0.86, 0.9],
    leaf: '#2e6a38',
    bark: '#5a3a26',
    link: '#1f5f2c',
    userColors: [
      '#7a3d00',
      '#8a2a66',
      '#1a6b4a',
      '#a3243f',
      '#8a4200',
      '#12677a',
      '#4b3aa6',
      '#4a6b12',
    ],
  },
  {
    id: 'sky-day',
    name: 'Day',
    kind: 'light',
    gradient: [
      [0, '#3d86d6'],
      [48, '#8cc4ee'],
      [100, '#e1f1f4'],
    ],
    ink: '#1d2a1a',
    panel: '#f8fbf4',
    panelAlpha: [0.66, 0.86, 0.9],
    leaf: '#2a6a34',
    bark: '#5a3e2b',
    link: '#1c5e2a',
    userColors: [
      '#0a5a96',
      '#8a2a66',
      '#1a6b4a',
      '#a3243f',
      '#8a4200',
      '#12677a',
      '#4b3aa6',
      '#4a6b12',
    ],
  },
  {
    id: 'sky-dusk',
    name: 'Dusk',
    kind: 'dark',
    gradient: [
      [0, '#1d1238'],
      [40, '#4a2a63'],
      [75, '#a2455a'],
      [100, '#e08a4a'],
    ],
    ink: '#f3ece4',
    panel: '#181020',
    panelAlpha: [0.7, 0.86, 0.9],
    leaf: '#8fd18a',
    bark: '#d2b79a',
    link: '#a8e0a2',
    userColors: [
      '#8cc8ff',
      '#f0a0ff',
      '#6fe0b0',
      '#ff93ad',
      '#ffb36b',
      '#6fdce0',
      '#b3a8ff',
      '#b8e87a',
    ],
  },
];

const family = (v: SkyVariant, main: Rgb, onMain: Rgb) => {
  const dark = v.kind === 'dark';
  const ink = hex(v.ink);
  const toward = dark ? WHITE : BLACK;
  const panel = hex(v.panel);
  const cont = mix(panel, main, dark ? 0.22 : 0.16); // opaque tinted panel under text
  return {
    Main: toHex(main),
    MainHover: toHex(mix(main, toward, 0.12)),
    MainActive: toHex(mix(main, toward, 0.2)),
    MainLine: toHex(mix(main, toward, 0.28)),
    OnMain: toHex(onMain),
    Container: toHex(cont),
    ContainerHover: toHex(mix(cont, main, 0.1)),
    ContainerActive: toHex(mix(cont, main, 0.18)),
    ContainerLine: toHex(mix(cont, main, 0.35)),
    OnContainer: toHex(mix(ink, main, dark ? 0.12 : 0.18)),
  };
};

const panelSet = (v: SkyVariant, alpha: number) => {
  const dark = v.kind === 'dark';
  const base = hex(v.panel);
  const ink = hex(v.ink);
  const t = dark ? 0.07 : 0.06;
  return {
    Container: rgba(base, alpha),
    ContainerHover: rgba(mix(base, ink, t), alpha),
    ContainerActive: rgba(mix(base, ink, t * 2), alpha),
    ContainerLine: rgba(mix(base, ink, 0.3), Math.min(1, alpha + 0.05)),
    OnContainer: v.ink,
  };
};

// folds' colour contract, one theme per variant.
export const foldsTheme = (v: SkyVariant) => {
  const dark = v.kind === 'dark';
  const leaf = hex(v.leaf);
  const bark = hex(v.bark);
  const onLeaf: Rgb = dark ? hex('#10270f') : WHITE;
  const onBark: Rgb = dark ? hex('#2a1b10') : hex('#fbf3ea');
  const status = (light: string, darkC: string) =>
    family(v, hex(dark ? darkC : light), dark ? hex('#10140d') : WHITE);
  return {
    Background: panelSet(v, v.panelAlpha[0]),
    Surface: panelSet(v, v.panelAlpha[1]),
    SurfaceVariant: panelSet(v, v.panelAlpha[2]),
    Primary: family(v, leaf, onLeaf),
    Secondary: family(v, bark, onBark),
    Success: status('#1f7a4a', '#7fe0b0'),
    Warning: status('#8a4a00', '#e8b866'),
    Critical: status('#a01c1c', '#f09a9a'),
    Other: {
      FocusRing: rgba(leaf, 0.7),
      Shadow: dark ? 'rgb(0 0 0 / 0.6)' : 'rgb(43 29 20 / 0.25)',
      Overlay: dark ? 'rgb(12 6 20 / 0.8)' : 'rgb(43 29 20 / 0.5)',
    },
  };
};

export const skyGradientCss = (v: SkyVariant) =>
  `linear-gradient(180deg, ${v.gradient.map(([p, c]) => `${c} ${p}%`).join(', ')})`;

// Chrome colour (meta theme-color, manifest): the default theme's sky at the top edge.
export const DEFAULT_SKY_ID = 'sky-dusk';
export const chromeColor = (id: string = DEFAULT_SKY_ID) => {
  const v = SKY_VARIANTS.find((s) => s.id === id) ?? SKY_VARIANTS[0];
  return v.gradient[0][1];
};
