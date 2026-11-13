import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

describe('icon buttons in room settings, space settings, lobby, search and explore', () => {
  // The class each IconButton must carry, in source order. Vertical stacks and lone buttons: the plain PhoneHit.
  const expected: Record<string, string[]> = {
    'features/room-settings/RoomSettings.tsx': ['PhoneHit'], // close, phone only, alone at the header end
    'features/room-settings/general/General.tsx': ['PhoneHit'], // close, 40 px
    'features/room-settings/permissions/Permissions.tsx': ['PhoneHit'],
    'features/space-settings/SpaceSettings.tsx': ['PhoneHit'],
    'features/space-settings/general/General.tsx': ['PhoneHit'],
    'features/space-settings/permissions/Permissions.tsx': ['PhoneHit'],
    // 16 px icon + 8 padding = 24 px, 8-12 px from the Open / Add chips beside it in a hierarchy card
    'features/lobby/HierarchyItemMenu.tsx': ['PhoneHitSpread24'],
    'features/lobby/Lobby.tsx': ['PhoneHit'], // floating scroll-to-top, alone
    'features/message-search/MessageSearch.tsx': ['PhoneHit'], // floating scroll-to-top, alone
    'pages/client/explore/Explore.tsx': ['PhoneHit'], // Add Server dialog close
  };

  it.each(Object.entries(expected))(
    '%s: each IconButton carries its own PhoneHit class',
    (file, want) => expectPhoneHitClasses(file, want)
  );

  it.each(Object.keys(expected))('%s: a sized variant matches the drawn size', (file) =>
    expectSizeTie(file)
  );
});
