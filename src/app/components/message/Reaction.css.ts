import { createVar, style } from '@vanilla-extract/css';
import { DefaultReset, FocusOutline, color, config, toRem } from 'folds';
import { MOBILE_BREAKPOINT } from '../../hooks/useScreenSize';
import { PHONE_TAP } from '../../styles/PhoneHit.css';

const PHONE = `screen and (max-width: ${MOBILE_BREAKPOINT}px)`;
const Container = createVar();
const ContainerHover = createVar();
const ContainerActive = createVar();
const ContainerLine = createVar();
const OnContainer = createVar();

export const Reaction = style([
  FocusOutline,
  {
    vars: {
      [Container]: color.SurfaceVariant.Container,
      [ContainerHover]: color.SurfaceVariant.ContainerHover,
      [ContainerActive]: color.SurfaceVariant.ContainerActive,
      [ContainerLine]: color.SurfaceVariant.ContainerLine,
      [OnContainer]: color.SurfaceVariant.OnContainer,
    },
    padding: `${toRem(2)} ${config.space.S200} ${toRem(2)} ${config.space.S100}`,
    backgroundColor: Container,
    border: `${config.borderWidth.B300} solid ${ContainerLine}`,
    borderRadius: config.radii.R300,

    selectors: {
      'button&': {
        cursor: 'pointer',
        // Phone tap target: the chip is 26 px tall, so its hit area grows 9 px above and below (an ::after) and the
        // same 9 px of margin opens the row, so the chips of one row and of the next never share a tap.
        '@media': { [PHONE]: { position: 'relative', marginBlock: (PHONE_TAP - 26) / 2 } },
      },
      'button&::after': {
        '@media': {
          [PHONE]: { content: '""', position: 'absolute', inset: `${-(PHONE_TAP - 26) / 2}px 0` },
        },
      },
      '&[aria-pressed=true]': {
        vars: {
          [Container]: color.Primary.Container,
          [ContainerHover]: color.Primary.ContainerHover,
          [ContainerActive]: color.Primary.ContainerActive,
          [ContainerLine]: color.Primary.ContainerLine,
          [OnContainer]: color.Primary.OnContainer,
        },
        backgroundColor: Container,
      },
      '&[aria-selected=true]': {
        borderColor: color.Secondary.Main,
        borderWidth: config.borderWidth.B400,
      },
      '&:hover, &:focus-visible': {
        backgroundColor: ContainerHover,
      },
      '&:active': {
        backgroundColor: ContainerActive,
      },
      '&[aria-disabled=true], &:disabled': {
        cursor: 'not-allowed',
      },
    },
  },
]);

export const ReactionText = style([
  DefaultReset,
  {
    minWidth: 0,
    maxWidth: toRem(150),
    display: 'inline-flex',
    alignItems: 'center',
    lineHeight: toRem(20),
  },
]);

export const ReactionImg = style([
  DefaultReset,
  {
    height: '1em',
    minWidth: 0,
    maxWidth: toRem(150),
    objectFit: 'contain',
  },
]);
