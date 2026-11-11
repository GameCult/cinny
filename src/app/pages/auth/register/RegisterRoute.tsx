import { Box, Text } from 'folds';
import React, { useEffect } from 'react';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { registrationEntry } from '../registrationEntry';
import { Register } from './Register';

// With the Register switch on, a stranger gets one way to register: the account service's own
// page. This route sends them there (the link stays for when the redirect does not run). With
// the switch off, the in-client form is the way.
export function RegisterRoute() {
  const entry = registrationEntry(useClientConfig());
  useEffect(() => {
    if (entry) window.location.replace(entry.url);
  }, [entry]);
  if (!entry) return <Register />;
  return (
    <Box direction="Column" gap="300">
      <Text size="H2" priority="400">
        Register
      </Text>
      <Text>
        Sign-up happens on the account page. <a href={entry.url}>Continue to sign up</a>
      </Text>
    </Box>
  );
}
