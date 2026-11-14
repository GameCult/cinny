import { Box, Button, Text } from 'folds';
import React from 'react';
import { clearLoginData } from '../../../../client/initMatrix';
import type { SoftLogoutRecord } from '../../../state/softLogout';

// Sign-in after the server dropped the token but not the device. "Someone else" is the hard path.
export function SoftLogoutNotice({ record }: { record: SoftLogoutRecord }) {
  return (
    <Box direction="Column" gap="200" alignItems="Start">
      <Text size="T300">
        Your session expired. Your local data was kept; sign in as {record.userId} to pick it up.
      </Text>
      <Button type="button" variant="Secondary" fill="Soft" size="300" onClick={clearLoginData}>
        <Text as="span" size="B300">
          Sign in as someone else
        </Text>
      </Button>
    </Box>
  );
}
