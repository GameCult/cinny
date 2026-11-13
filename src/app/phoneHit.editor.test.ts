import { describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT } from './hooks/useScreenSize';
import {
  emitted,
  expectPhoneHitClasses,
  expectSizeTie,
  iconButtonTags,
  readSource,
  rulesFor,
  type SizeAllow,
} from './phoneHitTestKit';

describe('icon buttons in the editor, emoji board, upload cards and client root', () => {
  // The class each IconButton must carry, in source order.
  const expected: Record<string, string[]> = {
    'components/editor/Toolbar.tsx': [
      'PhoneHitSpread36', // mark button: size 400 + 20 px icon, in a row 4 px apart
      'PhoneHitSpread36', // block button, same row
      'PhoneHitRoom36', // heading 1, inside the heading Menu (overflow hidden)
      'PhoneHitRoom36', // heading 2
      'PhoneHitRoom36', // heading 3
      'PhoneHit', // heading opener: two 20 px icons, 56 px wide, only its height is short
      'PhoneHit', // Exit chip: text label, wider than 44 px
      'PhoneHit', // markdown toggle, alone at the end of the toolbar
    ],
    // A column of 40 px buttons: there is no vertical variant, so only PhoneHit; neighbours overlap by their 2 px gap.
    'components/emoji-board/components/Sidebar.tsx': ['PhoneHit'],
    // Both cards put a Retry chip beside the cancel button when the upload failed.
    'components/upload-card/UploadCardRenderer.tsx': ['PhoneHitSpread28'],
    'components/upload-card/CompactUploadCardRenderer.tsx': ['PhoneHitSpread28'],
    'pages/client/ClientRoot.tsx': ['PhoneHit'], // alone, absolute in the corner
  };

  const sizeAllow: SizeAllow = {};

  it.each(Object.entries(expected))(
    '%s: each IconButton carries its own PhoneHit class',
    (file, want) => expectPhoneHitClasses(file, want)
  );

  it.each(Object.keys(expected))('%s: Spread and Room variants name the size they draw', (file) =>
    expectSizeTie(file, sizeAllow)
  );
});

describe('the estate navigator find button', () => {
  // The only IconButton there needs no PhoneHit: every button in the navigator header is 44 px on a phone because
  // the Targets class sets a min size, and the button sits under that class.
  it('is 44 px by the Targets class instead', async () => {
    const src = readSource('features/estate/EstateNavigator.tsx');
    const tags = iconButtonTags(src);
    expect(tags).toHaveLength(1);
    expect(tags[0]).not.toMatch(/PhoneHit/);
    const header = src.slice(src.indexOf('<PageNavHeader>'));
    expect(header.indexOf('className={css.Targets}')).toBeGreaterThan(-1);
    expect(header.indexOf('className={css.Targets}')).toBeLessThan(header.indexOf('<IconButton'));
    const css = await emitted('features/estate/EstateNavigator.css.ts');
    const phone = rulesFor(css, /button/, `screen and (max-width: ${MOBILE_BREAKPOINT}px)`);
    expect(phone).toContainEqual({ 'min-height': 44, 'min-width': 44 });
  });
});
