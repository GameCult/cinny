import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

describe('icon buttons in settings A', () => {
  // The class each IconButton must carry, in source order. Every one is alone in its row (a header close next to
  // non-tappable title text, an input slot, or a list tile beside a non-tappable Avatar), so the plain PhoneHit.
  const expected: Record<string, string[]> = {
    'features/settings/developer-tools/DevelopTools.tsx': ['PhoneHit'], // header close, 40 px
    'features/settings/notifications/Notifications.tsx': ['PhoneHit'], // header close, 40 px
    'features/settings/notifications/KeywordMessages.tsx': ['PhoneHit', 'PhoneHit'], // input reset, remove: 26 px, alone
    'features/settings/emojis-stickers/EmojisStickers.tsx': ['PhoneHit'], // header close, 40 px
    'features/settings/emojis-stickers/GlobalPacks.tsx': ['PhoneHit', 'PhoneHit'], // undo / remove, a ternary pair, 26 px
    'features/settings/Settings.tsx': ['PhoneHit'], // mobile-only header close, 40 px
    'features/settings/about/About.tsx': ['PhoneHit'], // header close, 40 px
    'features/settings/general/General.tsx': ['PhoneHit', 'PhoneHit', 'PhoneHit'], // reset / info (ternary), header close
    'features/settings/account/Account.tsx': ['PhoneHit'], // header close, 40 px
    'features/settings/devices/Devices.tsx': ['PhoneHit'], // header close, 40 px
  };

  it.each(Object.entries(expected))('%s carries the right hit-area class', (file, want) => {
    expectPhoneHitClasses(file, want);
  });

  // Plain PhoneHit has no size to tie, so nothing is allow-listed; the check still fails an allow-list entry
  // or a sized variant that disagrees with the drawn size if one is added later.
  it.each(Object.keys(expected))('%s ties a sized variant to the drawn size', (file) => {
    expectSizeTie(file);
  });
});
