import { createVar, globalStyle, keyframes, style, styleVariants } from '@vanilla-extract/css';
import { recipe, RecipeVariants } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

export const StickySection = style({
  position: 'sticky',
  top: config.space.S100,
});

const SpacingVar = createVar();
const SpacingVariant = styleVariants({
  '0': {
    vars: {
      [SpacingVar]: config.space.S0,
    },
  },
  '100': {
    vars: {
      [SpacingVar]: config.space.S100,
    },
  },
  '200': {
    vars: {
      [SpacingVar]: config.space.S200,
    },
  },
  '300': {
    vars: {
      [SpacingVar]: config.space.S300,
    },
  },
  '400': {
    vars: {
      [SpacingVar]: config.space.S400,
    },
  },
  '500': {
    vars: {
      [SpacingVar]: config.space.S500,
    },
  },
});

const highlightAnime = keyframes({
  '0%': {
    backgroundColor: color.Primary.Container,
  },
  '25%': {
    backgroundColor: color.Primary.ContainerActive,
  },
  '50%': {
    backgroundColor: color.Primary.Container,
  },
  '75%': {
    backgroundColor: color.Primary.ContainerActive,
  },
  '100%': {
    backgroundColor: color.Primary.Container,
  },
});
const HighlightVariant = styleVariants({
  true: {
    animation: `${highlightAnime} 2000ms ease-in-out`,
    animationIterationCount: 'infinite',
  },
});

const SelectedVariant = styleVariants({
  true: {
    backgroundColor: color.Surface.ContainerActive,
  },
});

const AutoCollapse = style({
  selectors: {
    [`&+&`]: {
      marginTop: 0,
    },
  },
});

export const MessageBase = recipe({
  base: [
    DefaultReset,
    {
      marginTop: SpacingVar,
      padding: `${config.space.S100} ${config.space.S200} ${config.space.S100} ${config.space.S400}`,
      borderRadius: `0 ${config.radii.R400} ${config.radii.R400} 0`,
    },
  ],
  variants: {
    space: SpacingVariant,
    collapse: {
      true: {
        marginTop: 0,
      },
    },
    autoCollapse: {
      true: AutoCollapse,
    },
    highlight: HighlightVariant,
    selected: SelectedVariant,
  },
  defaultVariants: {
    space: '400',
  },
});

export type MessageBaseVariants = RecipeVariants<typeof MessageBase>;

export const CompactHeader = style([
  DefaultReset,
  StickySection,
  {
    maxWidth: toRem(170),
    width: '100%',
  },
]);

export const AvatarBase = style({
  paddingTop: toRem(4),
  transition: 'transform 200ms cubic-bezier(0, 0.8, 0.67, 0.97)',
  display: 'flex',
  alignSelf: 'start',

  selectors: {
    '&:hover': {
      transform: `translateY(${toRem(-2)})`,
    },
  },
});

export const ModernBefore = style({
  minWidth: toRem(36),
});

export const BubbleBefore = style({
  minWidth: toRem(36),
});

export const BubbleContent = style({
  maxWidth: toRem(800),
  padding: config.space.S200,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R500,
  position: 'relative',
});

export const BubbleContentArrowLeft = style({
  borderTopLeftRadius: 0,
});

// Look of the three-doors mock-up (chat.gamecult.org/mockups/three-doors): a Mind's pose sits
// beside its bubble on wide screens; on phones it floats inside the bubble, overhanging the top
// edge, and the text wraps around its silhouette (shape-outside on the alpha channel).
const PHONE = 'screen and (max-width: 700px)';
const PORTRAIT = toRem(124);
const POSE_GUTTER = toRem(14);
const BUBBLE_CORNER = toRem(6);
const POP = 'cubic-bezier(0.34, 1.7, 0.64, 1)';
const RISE = 'cubic-bezier(0.34, 1.45, 0.64, 1)';

export const BubbleRowPose = style({
  position: 'relative',
  paddingLeft: `calc(${PORTRAIT} + ${POSE_GUTTER})`,
  '@media': {
    [PHONE]: {
      paddingLeft: 0,
    },
  },
});

// A row that shows a portrait: room for it to hang above the bubble on phones.
export const BubbleRowPortrait = style({
  minHeight: PORTRAIT,
  '@media': {
    [PHONE]: {
      minHeight: 0,
      marginTop: toRem(58),
    },
  },
});

export const BubbleRowOwn = style({
  justifyContent: 'flex-end',
});

export const BubbleColumnOwn = style({
  alignItems: 'flex-end',
  maxWidth: toRem(640),
});

export const BubbleHeaderOwn = style({
  alignSelf: 'flex-end',
});

// Phone: the name is a pill straddling the bubble's top edge, on the side opposite the portrait.
export const BubbleHeaderPose = style({
  '@media': {
    [PHONE]: {
      position: 'absolute',
      zIndex: 2,
      top: toRem(-15),
      right: toRem(14),
      padding: `0 ${toRem(13)}`,
      background: color.Secondary.Container,
      border: `1px solid ${color.Secondary.ContainerLine}`,
      borderRadius: toRem(999),
      whiteSpace: 'nowrap',
    },
  },
});

export const BubbleHeaderPoseAlt = style({
  '@media': {
    [PHONE]: {
      right: 'auto',
      left: toRem(14),
    },
  },
});

export const BubbleColumnPose = style({
  position: 'relative',
});

export const BubbleContentPose = style({
  borderRadius: config.radii.R500,
  borderTopLeftRadius: BUBBLE_CORNER,
  '@media': {
    [PHONE]: {
      display: 'flow-root',
      borderTopLeftRadius: config.radii.R500,
      padding: `${toRem(24)} ${toRem(14)} ${toRem(14)}`,
    },
  },
});

export const BubbleContentOwn = style({
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  border: `1px solid ${color.Primary.ContainerLine}`,
  borderRadius: config.radii.R500,
  borderTopRightRadius: BUBBLE_CORNER,
});

export const PoseButton = style({
  position: 'absolute',
  top: 0,
  left: `calc(-1 * (${PORTRAIT} + ${POSE_GUTTER}))`,
  width: PORTRAIT,
  height: PORTRAIT,
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  lineHeight: 0,
  transformOrigin: '50% 90%',
  '@media': {
    [PHONE]: {
      position: 'static',
      float: 'left',
      width: 'min(38vw, 160px)',
      height: 'auto',
      margin: `${toRem(-82)} ${toRem(8)} 0 ${toRem(-12)}`,
      shapeMargin: toRem(7),
      WebkitMaskImage: 'linear-gradient(#000 84%, transparent)',
      maskImage: 'linear-gradient(#000 84%, transparent)',
    },
  },
});

export const PoseButtonAlt = style({
  '@media': {
    [PHONE]: {
      float: 'right',
      margin: `${toRem(-82)} ${toRem(-12)} 0 ${toRem(8)}`,
    },
  },
});

export const PosePortrait = style({
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  objectPosition: 'top',
  '@media': {
    [PHONE]: {
      height: 'auto',
    },
  },
});

const pop = keyframes({
  from: { opacity: 0, transform: `translateY(${toRem(34)}) scale(0.42)` },
  to: { opacity: 1, transform: 'none' },
});
const rise = keyframes({
  from: { opacity: 0, transform: `translateY(${toRem(14)}) scale(0.96)` },
  to: { opacity: 1, transform: 'none' },
});

// First appearance of a message: the portrait pops, the bubble rises just behind it. The delay
// (a --enter-delay on the row) staggers messages that arrive together.
export const EnterPortrait = style({
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      animation: `${pop} 460ms ${POP} var(--enter-delay, 0ms) both`,
    },
  },
});

export const EnterBubble = style({
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      animation: `${rise} 380ms ${RISE} calc(var(--enter-delay, 0ms) + 50ms) both`,
    },
  },
});

export const BubbleLeftArrow = style({
  width: toRem(9),
  height: toRem(8),

  position: 'absolute',
  top: 0,
  left: toRem(-8),
  zIndex: 1,
});

export const Username = style({
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  selectors: {
    'button&': {
      cursor: 'pointer',
    },
    'button&:hover, button&:focus-visible': {
      textDecoration: 'underline',
    },
  },
});

export const UsernameBold = style({
  fontWeight: 550,
});

export const MessageTextBody = recipe({
  base: {
    wordBreak: 'break-word',
  },
  variants: {
    preWrap: {
      true: {
        whiteSpace: 'pre-wrap',
      },
    },
    jumboEmoji: {
      true: {
        fontSize: '1.504em',
        lineHeight: '1.4962em',
      },
    },
    emote: {
      true: {
        color: color.Success.Main,
        fontStyle: 'italic',
      },
    },
  },
});

export type MessageTextBodyVariants = RecipeVariants<typeof MessageTextBody>;

// The message content is a flex column, which forms its own block formatting context and so sits
// whole beside the floated portrait: the text stays as narrow as the gap beside it for the
// bubble's full height. As a plain block its lines wrap around the silhouette and then run the
// bubble's full width below it.
globalStyle(`${BubbleContentPose} > div`, {
  '@media': {
    [PHONE]: {
      display: 'block',
    },
  },
});

// An outside list marker hangs left of its item's text and ignores the portrait's silhouette, so
// beside a left portrait the number lands under the art. Inside, it is a word on the first line
// and wraps around the silhouette like the rest.
globalStyle(`${BubbleContentPose} ol, ${BubbleContentPose} ul`, {
  '@media': {
    [PHONE]: {
      listStylePosition: 'inside',
      paddingLeft: 0,
    },
  },
});

// While the background scene runs (html[data-scene]) a chat bubble is the one filled surface in
// the app: its own colour at half strength over a blur of the scene, so the words stay readable
// and the ridge shows through. The arrow wedge is opaque, so it goes.
const scene = ':root[data-scene]';
const half = (c: string) => `color-mix(in srgb, ${c} 50%, transparent)`;
globalStyle(`${scene} ${BubbleContent}`, {
  backgroundColor: [color.SurfaceVariant.Container, half(color.SurfaceVariant.Container)],
  backdropFilter: 'blur(12px)',
});
globalStyle(`${scene} ${BubbleContentOwn}`, {
  backgroundColor: [color.Primary.Container, half(color.Primary.Container)],
});
globalStyle(`${scene} ${BubbleHeaderPose}`, {
  '@media': {
    [PHONE]: {
      backgroundColor: [color.Secondary.Container, half(color.Secondary.Container)],
      backdropFilter: 'blur(12px)',
    },
  },
});
globalStyle(`${scene} ${BubbleLeftArrow}`, {
  display: 'none',
});
