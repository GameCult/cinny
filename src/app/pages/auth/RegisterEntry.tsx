import { Box, Text, color } from 'folds';
import React from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import { registrationEntry } from './registrationEntry';

// Beside Sign in. Nothing renders unless the config switch is on; the consent sentence and its
// version come from trainingNotice.ts, the same ones a room shows.
export function RegisterEntry() {
  const config = useClientConfig();
  const entry = registrationEntry(config);
  if (!entry) return null;
  return (
    <Box direction="Column" gap="100" alignItems="Center">
      <Text align="Center">
        Do not have an account? <a href={entry.url}>Register</a>
      </Text>
      <Text size="T200" align="Center" style={{ color: color.SurfaceVariant.OnContainer }}>
        {entry.notice} (notice version {entry.noticeVersion})
      </Text>
    </Box>
  );
}
