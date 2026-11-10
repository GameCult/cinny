import { Box, Text } from 'folds';
import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useClientConfig } from '../../hooks/useClientConfig';
import { getLoginPath } from '../pathUtils';
import { registrationEntry } from './registrationEntry';

// Where the account service sends a newcomer back. It promises nothing about mail or timing:
// the sign-up page said what happens next, and this page points back to it.
export function SignedUp() {
  const config = useClientConfig();
  if (!registrationEntry(config)) return <Navigate to={getLoginPath()} replace />;
  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        You signed up
      </Text>
      <Text>Follow the steps from the sign-up page to finish. Then sign in here.</Text>
      <Text>
        <Link to={getLoginPath()}>Sign in</Link>
      </Text>
    </Box>
  );
}
