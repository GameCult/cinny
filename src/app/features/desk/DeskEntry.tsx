import React from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { NavGutter, NavItem, NavItemContent, NavLink } from '../../components/nav';
import { NAV_ROOM_ICON_REST_OPACITY, NavLabel } from '../../components/nav/styles.css';
import { getDeskPath } from '../../pages/pathUtils';
import { buildDesk } from './buildDesk';
import { deskFor } from './source';
import { useUnverified } from './useUnverified';

export function DeskLink({ mind, open }: { mind: string; open: number }) {
  return (
    <NavItem variant="Background" radii="400">
      <NavLink to={getDeskPath(mind)}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <NavGutter>
              <Icon
                src={Icons.Bookmark}
                size="100"
                style={{ opacity: NAV_ROOM_ICON_REST_OPACITY }}
              />
            </NavGutter>
            <Text className={NavLabel} as="span" size="Inherit" truncate>
              {open > 0 ? `Desk · ${open} open` : 'Desk'}
            </Text>
          </Box>
        </NavItemContent>
      </NavLink>
    </NavItem>
  );
}

/** A Mind's desk, pinned at the top of its navigator group: always there, with the open count when there is one. */
export function DeskEntry({ mind }: { mind: string }) {
  const list = deskFor(mind);
  const unverified = useUnverified(list);
  // The same count the desk page shows; until the hash check lands there is no count to show.
  return <DeskLink mind={mind} open={unverified ? buildDesk(list, unverified).counts.open : 0} />;
}
