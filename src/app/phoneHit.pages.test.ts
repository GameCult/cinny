import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

// Page back buttons (and two lone buttons beside them). Every one is alone in its row, 40 px drawn (default
// IconButton and Icon), so plain PhoneHit; the vertical stacks of the page have no variant.
// null = deliberately without: LobbyHeader's Members button renders only when screenSize !== Mobile.
const files: Record<string, (string | null)[]> = {
  'features/lobby/LobbyHeader.tsx': ['PhoneHit', null, 'PhoneHit'],
  'features/join-before-navigate/JoinBeforeNavigate.tsx': ['PhoneHit'],
  'pages/client/space/Search.tsx': ['PhoneHit'],
  'pages/client/explore/Server.tsx': ['PhoneHit'],
  'pages/client/explore/Featured.tsx': ['PhoneHit'],
  'pages/client/home/CreateRoom.tsx': ['PhoneHit'],
  'pages/client/home/Search.tsx': ['PhoneHit'],
  // the second is the 30 px scroll-to-top pill, floating alone at the top centre
  'pages/client/inbox/Notifications.tsx': ['PhoneHit', 'PhoneHit'],
  'pages/client/inbox/Invites.tsx': ['PhoneHit'],
  'pages/client/direct/DirectCreate.tsx': ['PhoneHit'],
};

describe.each(Object.entries(files))('phone hit area: %s', (file, want) => {
  it('gives each IconButton its variant', () => {
    expectPhoneHitClasses(file, want);
  });
  // plain PhoneHit has no size to tie; this fails when a sized variant appears whose number is not the drawn px
  it('ties any sized variant to the drawn size', () => {
    expectSizeTie(file);
  });
});
