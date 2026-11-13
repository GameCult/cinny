import { Box, Text } from 'folds';
import React, { useEffect } from 'react';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { registrationEntry } from '../registrationEntry';
import { useMasAccountUrl } from '../masAccount';
import { MasAccountNotice } from '../MasAccountNotice';
import { Register } from './Register';

// With the Register switch on, a stranger gets one way to register: the account service's own
// page. This route sends them there (the link stays for when the redirect does not run). With
// the switch off, the in-client form is the way.
export function RegisterRoute() {
  const entry = registrationEntry(useClientConfig());
  const masUrl = useMasAccountUrl();
  useEffect(() => {
    if (entry) window.location.replace(entry.url);
  }, [entry]);
  // Under MAS the in-client sign-up (UIA) cannot work; with no configured entry the account page
  // is the only way. A configured entry keeps its own page and its training notice.
  if (!entry && masUrl) {
    return (
      <Box direction="Column" gap="300">
        <Text size="H2" priority="400">
          Register
        </Text>
        <MasAccountNotice url={masUrl} />
      </Box>
    );
  }
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
