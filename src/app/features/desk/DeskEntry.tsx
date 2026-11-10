import React from 'react';
import { Link } from 'react-router-dom';
import { Text } from 'folds';
import { getDeskPath } from '../../pages/pathUtils';
import { countOpen } from './buildDesk';
import { deskFor } from './source';

/** The way into a Mind's desk, set in its navigator group header; nothing at all when nothing is open. */
export function DeskEntry({ mind }: { mind: string }) {
  const open = countOpen(deskFor(mind));
  if (open === 0) return null;
  return (
    <Text as={Link} to={getDeskPath(mind)} size="T200" priority="300">
      {`Desk · ${open} open`}
    </Text>
  );
}
