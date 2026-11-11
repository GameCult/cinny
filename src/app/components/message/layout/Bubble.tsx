import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { Box, ContainerColor, as, color } from 'folds';
import * as css from './layout.css';

type BubbleArrowProps = {
  variant: ContainerColor;
};
function BubbleLeftArrow({ variant }: BubbleArrowProps) {
  return (
    <svg
      className={css.BubbleLeftArrow}
      width="9"
      height="8"
      viewBox="0 0 9 8"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.00004 8V0H4.82847C3.04666 0 2.15433 2.15428 3.41426 3.41421L8.00004 8H9.00004Z"
        fill={color[variant].Container}
      />
    </svg>
  );
}

type BubbleLayoutProps = {
  hideBubble?: boolean;
  /** The sender is the signed-in user: right-aligned, in the accent colour, no avatar. */
  own?: boolean;
  /** A Mind's pose portrait; it replaces the avatar and nests in a corner of the bubble. */
  pose?: ReactNode;
  /** Delay in ms before the first-appearance animation; undefined plays none. */
  enterDelay?: number;
  before?: ReactNode;
  header?: ReactNode;
};

export const BubbleLayout = as<'div', BubbleLayoutProps>(
  ({ hideBubble, own, pose, enterDelay, before, header, children, style, ...props }, ref) => {
    // `false` is a Mind's message continuing a run: aligned with the portraits, showing none.
    const poseRow = pose !== undefined;
    const arrow = !!before && !poseRow && !own;
    const entering = enterDelay !== undefined;
    return (
      <Box
        gap="300"
        {...props}
        className={classNames(own && css.BubbleRowOwn, props.className)}
        style={entering ? { ...style, ['--enter-delay' as string]: `${enterDelay}ms` } : style}
        ref={ref}
      >
        {!poseRow && !own && (
          <Box className={css.BubbleBefore} shrink="No">
            {before}
          </Box>
        )}
        <Box
          grow={own ? 'No' : 'Yes'}
          direction="Column"
          className={classNames(own && css.BubbleColumnOwn)}
        >
          {header && <div className={classNames(own && css.BubbleHeaderOwn)}>{header}</div>}
          {hideBubble ? (
            children
          ) : (
            <Box>
              <Box
                className={classNames(
                  css.BubbleContent,
                  arrow && css.BubbleContentArrowLeft,
                  poseRow && css.BubbleContentPose,
                  pose && css.BubbleContentPortrait,
                  own && css.BubbleContentOwn,
                  entering && css.EnterBubble
                )}
                direction="Column"
              >
                {arrow ? <BubbleLeftArrow variant="SurfaceVariant" /> : null}
                {pose}
                {children}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    );
  }
);
