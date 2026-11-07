import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { Box, ContainerColor, as, color } from 'folds';
import * as css from './layout.css';

type BubbleArrowProps = {
  variant: ContainerColor;
  pose?: boolean;
};
function BubbleLeftArrow({ variant, pose }: BubbleArrowProps) {
  return (
    <svg
      className={classNames(css.BubbleLeftArrow, pose && css.BubbleArrowPose)}
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
  pose?: boolean;
  before?: ReactNode;
  header?: ReactNode;
};

export const BubbleLayout = as<'div', BubbleLayoutProps>(
  ({ hideBubble, pose, before, header, children, ...props }, ref) => (
    <Box
      gap="300"
      {...props}
      className={classNames(pose && css.BubblePose, props.className)}
      ref={ref}
    >
      <Box className={pose ? css.BubbleBeforePose : css.BubbleBefore} shrink="No">
        {before}
      </Box>
      <Box grow="Yes" direction="Column">
        {header}
        {hideBubble ? (
          children
        ) : (
          <Box>
            <Box
              className={
                hideBubble
                  ? undefined
                  : classNames(
                      css.BubbleContent,
                      before ? css.BubbleContentArrowLeft : undefined,
                      pose && css.BubbleContentPoseStacked
                    )
              }
              direction="Column"
            >
              {before ? <BubbleLeftArrow variant="SurfaceVariant" pose={pose} /> : null}
              {children}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
);
