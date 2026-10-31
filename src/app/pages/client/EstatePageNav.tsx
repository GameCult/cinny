import React from 'react';
import { MobileFriendlyPageNav } from '../MobileFriendly';
import { EstateNavigator } from '../../features/estate';

/**
 * Where the navigator mounts in a route's nav slot. The wide-screen placement
 * question (ratatoskr:question:desktop-navigator-placement) is answered here.
 */
export function EstatePageNav({ path }: { path: string }) {
  return (
    <MobileFriendlyPageNav path={path}>
      <EstateNavigator />
    </MobileFriendlyPageNav>
  );
}
