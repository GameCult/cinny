import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

// Dialog and prompt close buttons: each is a 32 px button (24 px Icon + 8 px padding) alone at the end of a
// header whose title is not tappable, so the plain PhoneHit; no neighbour to spread from, no clipping container.
describe('icon buttons in dialogs and prompts', () => {
  const expected: Record<string, string[]> = {
    'features/create-space/CreateSpaceModal.tsx': ['PhoneHit'],
    'features/create-room/CreateRoomModal.tsx': ['PhoneHit'],
    'features/add-existing/AddExisting.tsx': ['PhoneHit'],
    'components/room-topic-viewer/RoomTopicViewer.tsx': ['PhoneHit'],
    'components/leave-room-prompt/LeaveRoomPrompt.tsx': ['PhoneHit'],
    'components/leave-space-prompt/LeaveSpacePrompt.tsx': ['PhoneHit'],
    'components/event-readers/EventReaders.tsx': ['PhoneHit'],
    'components/invite-user-prompt/InviteUserPrompt.tsx': ['PhoneHit'],
    'components/join-address-prompt/JoinAddressPrompt.tsx': ['PhoneHit'], // join cancel
    'components/user-profile/PowerChip.tsx': ['PhoneHit', 'PhoneHit'], // self demotion, shared power
  };

  it.each(Object.entries(expected))(
    '%s: each IconButton carries its own PhoneHit class',
    (file, want) => expectPhoneHitClasses(file, want)
  );

  it.each(Object.keys(expected))('%s: a sized variant matches the drawn size', (file) =>
    expectSizeTie(file)
  );
});
