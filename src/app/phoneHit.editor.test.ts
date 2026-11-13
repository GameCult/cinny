import { describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT } from './hooks/useScreenSize';
import {
  classLists,
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
    // A column of 40 px buttons 4 px apart (the stack's gap="100", pinned below): there is no vertical variant, so only
    // PhoneHit; the 44 px areas then touch with no overlap.
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

/** The JSX element opened at `open` (index of its `<Box`), to its matching `</Box>`: nesting is counted, not guessed (no self-closing Box here). */
const boxSpan = (src: string, open: number) => {
  const marks = [...src.slice(open).matchAll(/<Box(?=[\s>])|<\/Box>/g)];
  const depths = marks.map((m, i) =>
    marks.slice(0, i + 1).reduce((d, x) => d + (x[0] === '</Box>' ? -1 : 1), 0)
  );
  const end = depths.indexOf(0);
  if (end === -1) throw new Error('unbalanced <Box>');
  return [open, open + (marks[end].index ?? 0) + marks[end][0].length] as const;
};

describe('the estate navigator find button', () => {
  // The only IconButton there needs no PhoneHit: every button in the navigator header is 44 px on a phone because
  // the Targets class sets a min size, and the button sits inside the Box that carries that class.
  it('is 44 px by the Targets class instead', async () => {
    const src = readSource('features/estate/EstateNavigator.tsx');
    const tags = iconButtonTags(src);
    expect(tags).toHaveLength(1);
    expect(tags[0]).not.toMatch(/PhoneHit/);

    const header = src.indexOf('<PageNavHeader>');
    const boxStart = src.indexOf('<Box', header);
    const [from, to] = boxSpan(src, boxStart);
    expect(src.slice(boxStart, src.indexOf('>', boxStart))).toMatch(/className=\{css\.Targets\}/);
    const button = src.indexOf('<IconButton');
    expect(button).toBeGreaterThan(from);
    expect(button).toBeLessThan(to);

    // The rule is on the Targets class's own ident, for buttons, at the phone breakpoint.
    const ident = (await classLists('features/estate/EstateNavigator.css.ts')).Targets[0];
    const css = await emitted('features/estate/EstateNavigator.css.ts');
    const phone = rulesFor(
      css,
      new RegExp(`^\\.${ident} button(,|$)`),
      `screen and (max-width: ${MOBILE_BREAKPOINT}px)`
    );
    expect(phone).toEqual([{ 'min-height': 44, 'min-width': 44 }]);
  });
});

describe('what the PhoneHit class relies on', () => {
  // PhoneHit makes the button position: relative on a phone; the inline style wins over a class, so the corner
  // button stays absolute and its ::after anchors to it.
  it('ClientRoot keeps its corner button absolutely positioned inline', () => {
    const [tag] = iconButtonTags(readSource('pages/client/ClientRoot.tsx'));
    expect(tag).toMatch(/style=\{\{[^}]*position:\s*'absolute'/);
  });

  // A 40 px button with a 44 px area, in a column 4 px apart: the areas touch and do not overlap. A smaller gap
  // overlaps them, a larger one leaves a dead strip.
  it('the emoji sidebar stack keeps its 4 px gap', () => {
    const src = readSource('components/emoji-board/components/Sidebar.tsx');
    const stack = src.slice(
      src.indexOf('export const SidebarStack'),
      src.indexOf('export function SidebarDivider')
    );
    expect(stack).toMatch(/direction="Column"/);
    expect(stack).toMatch(/gap="100"/);
  });
});
