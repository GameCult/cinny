import React from 'react';
import { Box, Switch, Text } from 'folds';
import { useConstellationLines } from '../../../hooks/useSceneView';
import { setConstellationLines } from '../skyState';

/** The Sky submenu of the scene view: the constellation lines, an explicit option per viewer (it replaces the hidden re-pick of Night). Its data credits are in Place. */
export function SkySubmenu() {
  const lines = useConstellationLines();
  return (
    <Box direction="Column" gap="300">
      <Box alignItems="Center" justifyContent="SpaceBetween" gap="300">
        <Text as="label" id="scene-view-lines" size="T300">
          Constellation lines
        </Text>
        <Switch
          aria-labelledby="scene-view-lines"
          value={lines}
          onChange={(on: boolean) => setConstellationLines(on)}
        />
      </Box>
      <Text size="T200" priority="300">
        Drawn over the stars of a night sky.
      </Text>
    </Box>
  );
}
