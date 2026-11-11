import React from 'react';
import { as, Chip, Icon, Icons, Text } from 'folds';
import classNames from 'classnames';
import { NavGutter } from '../../components/nav';
import { NavPlate } from '../../components/nav/styles.css';
import * as css from './styles.css';

export const RoomNavCategoryButton = as<'button', { closed?: boolean }>(
  ({ className, closed, children, ...props }, ref) => (
    <Chip
      className={classNames(css.CategoryButton, className)}
      variant="Background"
      radii="Pill"
      aria-expanded={closed === undefined ? undefined : !closed}
      {...props}
      ref={ref}
    >
      <NavGutter>
        <Icon
          className={css.CategoryButtonIcon}
          size="50"
          src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
        />
      </NavGutter>
      <Text className={NavPlate} size="O400" priority="300" truncate>
        {children}
      </Text>
    </Chip>
  )
);
