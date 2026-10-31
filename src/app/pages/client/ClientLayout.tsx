import React, { ReactNode } from 'react';
import { Box } from 'folds';

export function ClientLayout({ children }: { children: ReactNode }) {
  return <Box grow="Yes">{children}</Box>;
}
