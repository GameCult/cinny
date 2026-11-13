import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

// Each IconButton here is alone in its slot (a dialog header's close, an input's clear button, a tile's lone
// menu or chevron button, its neighbours being text or a badge), so each takes PhoneHit. Every size is derivable
// from the source, so nothing is allow-listed; plain PhoneHit has no number to tie.
const files: [string, string[]][] = [
  ['features/settings/account/Profile.tsx', ['PhoneHit', 'PhoneHit']],
  ['features/settings/account/IgnoredUserList.tsx', ['PhoneHit']],
  ['features/settings/devices/Verification.tsx', ['PhoneHit']],
  ['features/settings/devices/DeviceTile.tsx', ['PhoneHit']],
  ['pages/auth/ServerPicker.tsx', ['PhoneHit']],
  ['components/BackupRestore.tsx', ['PhoneHit']],
  ['components/DeviceVerification.tsx', ['PhoneHit']],
  ['components/DeviceVerificationSetup.tsx', ['PhoneHit', 'PhoneHit']],
];

describe.each(files)('phone hit area: %s', (file, want) => {
  it('gives each icon button its variant', () => expectPhoneHitClasses(file, want));
  it('ties each sized variant to the size it draws', () => expectSizeTie(file));
});
