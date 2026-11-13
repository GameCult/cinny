import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

describe('icon buttons in message content and data editors', () => {
  // The class each IconButton must carry, in source order.
  const expected: Record<string, string[]> = {
    // mute toggle, 16 px icon + 8 padding = 24 px, 8 px from the volume slider (tappable)
    'components/message/content/AudioContent.tsx': ['PhoneHitSpread24'],
    // download, alone at the end of the header row (26 px)
    'components/message/FileHeader.tsx': ['PhoneHit'],
    // code block expand/collapse, 24 px, 8 px from the Copy chip
    'plugins/react-custom-html-parser.tsx': ['PhoneHitSpread24'],
    // close at the header end, alone
    'components/AccountDataEditor.tsx': ['PhoneHit'],
    'components/image-pack-view/ImagePackView.tsx': ['PhoneHit'],
  };

  it.each(Object.entries(expected))(
    '%s: each IconButton carries its own PhoneHit class',
    (file, want) => expectPhoneHitClasses(file, want)
  );

  it.each(Object.keys(expected))('%s: a sized variant matches the drawn size', (file) =>
    expectSizeTie(file)
  );
});
