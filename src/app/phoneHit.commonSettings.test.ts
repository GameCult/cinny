import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

// Every IconButton under features/common-settings, in source order. Header close buttons are alone at the
// header end (the title beside them is text), the dialog close buttons are alone in their Header, the
// scroll-to-top button floats alone, and the RoomPacks pair is a ternary (only one renders): all PhoneHit.
const files: [string, string[]][] = [
  ['features/common-settings/members/Members.tsx', ['PhoneHit', 'PhoneHit']],
  ['features/common-settings/developer-tools/SendRoomEvent.tsx', ['PhoneHit']],
  ['features/common-settings/developer-tools/StateEventEditor.tsx', ['PhoneHit']],
  ['features/common-settings/developer-tools/DevelopTools.tsx', ['PhoneHit']],
  ['features/common-settings/permissions/PowersEditor.tsx', ['PhoneHit']],
  ['features/common-settings/emojis-stickers/EmojisStickers.tsx', ['PhoneHit']],
  ['features/common-settings/emojis-stickers/RoomPacks.tsx', ['PhoneHit', 'PhoneHit']],
  ['features/common-settings/general/RoomEncryption.tsx', ['PhoneHit']],
  ['features/common-settings/general/RoomUpgrade.tsx', ['PhoneHit']],
];

describe.each(files)('phone hit area: %s', (file, want) => {
  it('carries the variant its drawn size and neighbours call for', () => {
    expectPhoneHitClasses(file, want);
  });
  it('names a size that matches what it draws', () => {
    expectSizeTie(file);
  });
});
