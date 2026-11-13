import { Text } from 'folds';
import React from 'react';

export function MasAccountNotice({ url }: { url: string }) {
  return (
    <Text align="Center">
      Accounts here are managed by your sign-in service. Create or recover an account on its{' '}
      <a href={url}>account page</a>.
    </Text>
  );
}
