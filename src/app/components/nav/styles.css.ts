import { ComplexStyleRule, StyleRule, createVar, globalStyle, style } from '@vanilla-extract/css';
import { RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { ContainerColor, DefaultReset, Disabled, RadiiVariant, color, config, toRem } from 'folds';
import { surfaceInk } from '../../features/scene/sceneShell.css';

// Wash strengths over the scene: rows and labels are faint, and hover, selected and pressed rows
// are three distinct steps above them.
// Meta, 2026-11-09: "this UI needs no chrome". Rows and labels are bare ink on the scene; hover and selection keep a faint wash.
const SCRIM_LABEL = '0%';
const SCRIM_ROW = '0%';
const SCRIM_HOVER = '14%';
const SCRIM_SELECTED = '22%';
const SCRIM_PRESSED = '48%';

// The navigator's one column grid. Every row, section header and join row begins with a gutter of
// the same width, with its chevron, room icon or avatar centred in it, so every label starts at
// the same x for its depth; each nesting level (NavLevel) indents by one constant step.
const GUTTER = toRem(32);
const LEVEL_STEP = toRem(16);

export const NavGutter = style({
  width: GUTTER,
  minWidth: GUTTER,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const NavLevel = style({
  paddingLeft: LEVEL_STEP,
});

// Chevrons and room icons are matched in measured ink (a room glyph is about 1.7x a chevron's, unread rooms stay far above), so a foldout is not outweighed by its rooms.
export const NAV_ICON_REST_OPACITY = 0.9;
// A room's glyph is bigger and denser than the chevron, so it rests lighter to read as the same weight.
export const NAV_ROOM_ICON_REST_OPACITY = 0.26;
export const NAV_ICON_UNREAD_OPACITY = 0.9;

export const NavCategory = style([
  DefaultReset,
  {
    position: 'relative',
  },
]);

export const NavCategoryHeader = style({
  gap: config.space.S100,
  selectors: {
    // The header's own side padding would shift its gutter off the rows': the section button
    // carries the same left inset as NavItemContent instead.
    '&&': { paddingLeft: 0 },
  },
  '@media': {
    // Category labels sit on the scene like the rows do, and need a wash to be read (wide screens;
    // a phone's list is plain text).
    'screen and (min-width: 751px)': {
      selectors: {
        ':root[data-scene] &': {
          backgroundColor: `color-mix(in srgb, ${surfaceInk} ${SCRIM_LABEL}, transparent)`,
          borderRadius: config.radii.R400,
        },
      },
    },
  },
});

export const NavLink = style({
  color: 'inherit',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  flexGrow: 1,
  ':hover': {
    textDecoration: 'unset',
  },
  ':focus': {
    outline: 'none',
  },
});

const Container = createVar();
const ContainerHover = createVar();
const ContainerActive = createVar();
const ContainerLine = createVar();
const OnContainer = createVar();

const getVariant = (variant: ContainerColor): ComplexStyleRule => ({
  vars: {
    [Container]: color[variant].Container,
    [ContainerHover]: color[variant].ContainerHover,
    [ContainerActive]: color[variant].ContainerActive,
    [ContainerLine]: color[variant].ContainerLine,
    [OnContainer]: color[variant].OnContainer,
  },
});

// The room list is plain text on a phone: no pill, slab or border behind any row, and hover,
// selected and pressed show in the label (NavLabel), never in a box. Wider screens keep the rows
// and the wash.
const WIDE = 'screen and (min-width: 751px)';
const PHONE = 'screen and (max-width: 750px)';

const NavItemBase = style({
  width: '100%',
  display: 'flex',
  justifyContent: 'start',
  cursor: 'pointer',
  backgroundColor: Container,
  color: OnContainer,
  outline: 'none',
  minHeight: toRem(36),

  '@media': {
    [PHONE]: {
      backgroundColor: 'transparent',
      borderRadius: 0,
    },
    [WIDE]: {
      selectors: {
        '&:hover, &:focus-visible': {
          backgroundColor: ContainerHover,
        },
        '&[data-hover=true]': {
          backgroundColor: ContainerHover,
        },
        // While the background scene runs the shell is clear (sceneShell.css.ts); a row is a faint
        // wash of the theme's own surface: the terrain stays visible, the text stays readable.
        // Hover, the selected row and a press each strengthen it a step.
        ':root[data-scene] &': {
          backgroundColor: `color-mix(in srgb, ${surfaceInk} ${SCRIM_ROW}, transparent)`,
        },
        ':root[data-scene] &:hover, :root[data-scene] &:focus-visible, :root[data-scene] &[data-hover=true]':
          {
            backgroundColor: `color-mix(in srgb, ${surfaceInk} ${SCRIM_HOVER}, transparent)`,
          },
        ':root[data-scene] &[aria-selected=true]': {
          backgroundColor: `color-mix(in srgb, ${surfaceInk} ${SCRIM_SELECTED}, transparent)`,
        },
        [`:root[data-scene] &:has(.${NavLink}:active)`]: {
          backgroundColor: `color-mix(in srgb, ${surfaceInk} ${SCRIM_PRESSED}, transparent)`,
        },
        [`&:has(.${NavLink}:active)`]: {
          backgroundColor: ContainerActive,
        },
        '&[aria-selected=true]': {
          backgroundColor: ContainerActive,
        },
      },
    },
  },
  selectors: {
    [`&:has(.${NavLink}:focus-visible)`]: {
      outline: `${config.borderWidth.B600} solid ${ContainerLine}`,
      outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
    },
  },
  '@supports': {
    [`not selector(:has(.${NavLink}:focus-visible))`]: {
      ':focus-within': {
        outline: `${config.borderWidth.B600} solid ${ContainerLine}`,
        outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
      },
    },
  },
});
export const NavItem = recipe({
  base: [DefaultReset, NavItemBase, Disabled],
  variants: {
    variant: {
      Background: getVariant('Background'),
      Surface: getVariant('Surface'),
      SurfaceVariant: getVariant('SurfaceVariant'),
      Primary: getVariant('Primary'),
      Secondary: getVariant('Secondary'),
      Success: getVariant('Success'),
      Warning: getVariant('Warning'),
      Critical: getVariant('Critical'),
    },
    radii: RadiiVariant,
  },
  defaultVariants: {
    variant: 'Surface',
    radii: '400',
  },
});

export type RoomSelectorVariants = RecipeVariants<typeof NavItem>;
export const NavItemContent = style({
  paddingLeft: config.space.S200,
  paddingRight: config.space.S300,
  height: 'inherit',
  minWidth: 0,
  flexGrow: 1,
  display: 'flex',
  alignItems: 'center',
  fontWeight: config.fontWeight.W500,

  selectors: {
    '&:hover': {
      textDecoration: 'unset',
    },
    [`.${NavItemBase}[data-highlight=true] &`]: {
      fontWeight: config.fontWeight.W600,
    },
  },
});

export const NavItemOptions = style({
  paddingRight: config.space.S200,
});

// A room's name on a phone wears the section headings' type (small caps-height, uppercase, 600,
// at heading strength) and states itself in the text: hover and focus underline it, the selected
// row is bolder and underlined, a press dims it, an unread room is at full strength. Over the scene
// a halo of the theme's own surface keeps it readable without a box.
export const NavLabel = style({});
const label = `.${NavLabel}.${NavLabel}`;
const phoneLabel = (selector: string, rule: StyleRule) =>
  globalStyle(selector, { '@media': { [PHONE]: rule } });

phoneLabel(label, {
  fontSize: toRem(12),
  lineHeight: toRem(16),
  fontWeight: config.fontWeight.W600,
  textTransform: 'uppercase',
  opacity: 0.75,
  textDecorationThickness: '1px',
  textUnderlineOffset: toRem(4),
});
phoneLabel(
  [
    `.${NavItemBase}:hover ${label}`,
    `.${NavItemBase}:focus-visible ${label}`,
    `.${NavItemBase}[data-hover=true] ${label}`,
    `.${NavItemBase}[data-highlight=true] ${label}`,
  ].join(', '),
  { opacity: 1 }
);
phoneLabel(`.${NavItemBase}:hover ${label}, .${NavItemBase}:focus-visible ${label}`, {
  textDecorationLine: 'underline',
});
phoneLabel(`.${NavItemBase}[aria-selected=true] ${label}`, {
  opacity: 1,
  fontWeight: config.fontWeight.W700,
  textDecorationLine: 'underline',
  textDecorationThickness: '2px',
});
phoneLabel(`.${NavItemBase}:has(.${NavLink}:active) ${label}`, {
  opacity: 0.6,
  textDecorationLine: 'underline',
});
// Over the scene a label sits on a feathered plate of the theme's own surface (not a card: no edge, the
// shadow carries it past the text) and wears the theme's own ink, the colour that surface was made for.
// The plate is on the label itself, so the label is at full strength here: an opacity would fade the plate too.
const LABEL_PLATE = `color-mix(in srgb, ${surfaceInk} 80%, transparent)`;
/** The same plate for text that is not a row label (a foldout's heading). */
export const NavPlate = style({});
globalStyle(`:root[data-scene] ${label}, :root[data-scene] .${NavPlate}`, {
  opacity: 1,
  backgroundColor: LABEL_PLATE,
  boxShadow: `0 0 6px 5px ${LABEL_PLATE}`,
  borderRadius: toRem(6),
});

// Icons, dots and the Join action share the label's halo over the scene.
globalStyle(`:root[data-scene] ${NavItemBase} svg, :root[data-scene] ${NavItemBase} button`, {
  '@media': {
    [PHONE]: {
      filter: `drop-shadow(0 0 3px ${surfaceInk})`,
    },
  },
});

// The Join action is a plain underlined word on every screen, not a pill.
export const NavAction = style({
  selectors: {
    '&&': {
      backgroundColor: 'transparent',
      boxShadow: 'none',
      border: 'none',
      borderRadius: 0,
      minWidth: 0,
      textDecoration: 'underline',
      textUnderlineOffset: toRem(4),
      flexShrink: 0,
    },
  },
});
