import { describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT } from './hooks/useScreenSize';
import {
  classLists,
  emitted,
  expectPhoneHitClasses,
  expectSizeTie,
  rulesFor,
  type SizeAllow,
} from './phoneHitTestKit';

const PHONE = `screen and (max-width: ${MOBILE_BREAKPOINT}px)`;
const TAP = 44;

// [target, css file, selector, measured height in CSS px on the Starfire phone run (390x844), free space measured
// above and below the target before its neighbour's box (taps2-REPORT.md): the hit area may reach out of the layout
// box (negative margin) by no more than that, or it takes taps from its neighbour. Space it needs beyond that is
// real layout growth, which the rules above take from the padding the margin does not give back.
const targets: [string, string, RegExp, number, number, number][] = [
  [
    'sender-name button',
    'components/message/layout/layout.css.ts',
    /^button\.layout_Username__/,
    23,
    11,
    11,
  ],
  [
    'room-topic button',
    'features/room/RoomViewHeader.css.ts',
    /RoomViewHeader_HeaderTopic__\w+$/,
    18,
    0,
    26,
  ],
  ['sign-in card links', 'pages/auth/styles.css.ts', /styles_AuthCard__\w+ a$/, 16, 14, 14],
  [
    'forget-password link',
    'pages/auth/styles.css.ts',
    /styles_AuthCard__\w+ a\.styles_ForgotLink__\w+$/,
    16,
    5,
    16,
  ],
  // The footer's rows are 22 px apart on a phone (AuthFooterLinks), 11 px for each side of the gap.
  ['sign-in footer links', 'pages/auth/styles.css.ts', /styles_AuthFooter__\w+ a$/, 22, 11, 11],
];

describe.each(targets)('phone tap target: %s', (_name, file, selector, height, above, below) => {
  it(`grows its hit area to ${TAP} px without moving layout`, async () => {
    const css = await emitted(file);
    const [phone] = rulesFor(css, selector, PHONE);
    expect(phone, 'a phone rule exists').toBeDefined();
    const top = phone['padding-top'] ?? phone['padding-block'] ?? 0;
    const bottom = phone['padding-bottom'] ?? phone['padding-block'] ?? 0;
    const marginTop = phone['margin-top'] ?? phone['margin-block'] ?? 0;
    const marginBottom = phone['margin-bottom'] ?? phone['margin-block'] ?? 0;
    expect(height + top + bottom).toBeGreaterThanOrEqual(TAP);
    // the hit area reaches out of the layout box by no more than the free space on that side
    expect(-marginTop).toBeLessThanOrEqual(above);
    expect(-marginBottom).toBeLessThanOrEqual(below);
    expect(marginTop).toBeLessThanOrEqual(0);
    expect(marginBottom).toBeLessThanOrEqual(0);
  });

  it('leaves every other screen as it was: no padding or margin outside the phone query', async () => {
    const css = await emitted(file);
    rulesFor(css, selector, undefined).forEach((decls) =>
      expect(Object.keys(decls).filter((k) => /^(padding|margin)/.test(k))).toEqual([])
    );
  });
});

describe('phone navigator rows', () => {
  // The links and buttons inside a row are 44 px (EstateNavigator.css.ts); a row shorter than that lets them spill
  // onto the next row (the 38 px pitch of taps2-REPORT.md), so the row and the section header are 44 too.
  it('are as tall as their tap targets', async () => {
    const css = await emitted('components/nav/styles.css.ts');
    const phone = [
      ...css.matchAll(/@media screen and \(max-width: 750px\) \{\n([\s\S]*?\n)\}(?:\n|$)/g),
    ]
      .map((m) => m[1])
      .join('\n');
    expect(phone.match(/min-height: 2\.75rem/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('phone icon-button hit areas', () => {
  const stripPhone = (css: string) => css.replace(/@media [^{]+ \{\n[\s\S]*?\n\}(?:\n|$)/g, '');

  it('draw a 44 x 44 box around the button on a phone and nothing on any other screen', async () => {
    const css = await emitted('styles/PhoneHit.css.ts');
    const phone = [...css.matchAll(/@media ([^{]+) \{\n([\s\S]*?\n)\}(?:\n|$)/g)];
    expect(phone.map((m) => m[1])).toEqual([PHONE]);
    expect(css).toMatch(/::after \{[^}]*width: max\(100%, 44px\);[^}]*height: max\(100%, 44px\);/);
    // no content, no box: the pseudo-element is not rendered at all
    expect(css).toMatch(/::after \{[^}]*content: "";/);
    expect(css).toMatch(/::after \{[^}]*position: absolute;/);
    // centred on the button: top and left at half, pulled back by half its own size
    expect(css).toMatch(/::after \{[^}]*top: 50%;/);
    expect(css).toMatch(/::after \{[^}]*left: 50%;/);
    expect(css).toMatch(/::after \{[^}]*transform: translate\(-50%, -50%\);/);
    // the box anchors to its own button, receives the tap, and sits above nothing it should not
    expect(css).toMatch(/@media [^{]+ \{\n\s*\.PhoneHit_PhoneHit__\w+ \{\n\s*position: relative;/);
    // PhoneHit and PhoneHitInPlace each draw it; the Spread and Room classes compose PhoneHit
    const afters = [...css.matchAll(/::after \{\n([^}]*)\}/g)];
    expect(afters).toHaveLength(2);
    const afterDecls = afters.flatMap((m) =>
      m[1]
        .split('\n')
        .map((l) => l.trim().split(':')[0])
        .filter(Boolean)
    );
    expect([...new Set(afterDecls)].sort()).toEqual([
      'content',
      'height',
      'left',
      'position',
      'top',
      'transform',
      'width',
    ]);
    // nothing on a phone moves a button off its own anchor: only relative (the button) and absolute (the boxes)
    expect([...css.matchAll(/position: (\w+);/g)].map((m) => m[1]).sort()).toEqual([
      'absolute',
      'absolute',
      'relative',
    ]);
    expect(stripPhone(css).trim()).toBe('');
  });

  it('open a row up by half the shortfall, so neighbouring hit areas meet and do not overlap', async () => {
    const css = await emitted('styles/PhoneHit.css.ts');
    const margins = (selector: RegExp) =>
      rulesFor(css, selector, PHONE).map((d) => d['margin-inline']);
    // 32 px composer buttons, 40 px header buttons, 26 px message-option buttons (which also open vertically,
    // the menu around them clips a hit area drawn outside its box)
    // each class owns its own margin: (44 - drawn size) / 2
    const own = (size: number) => margins(new RegExp(`PhoneHit_PhoneHitSpread${size}__`));
    expect([24, 26, 28, 32, 36, 40].map(own)).toEqual([[10], [9], [8], [6], [4], [2]]);
    // the Room variants open the block axis by the same amount, on top of their Spread class
    const room = (size: number) =>
      rulesFor(css, new RegExp(`PhoneHit_PhoneHitRoom${size}__`), PHONE);
    expect([room(26), room(36)]).toEqual([[{ 'margin-block': 9 }], [{ 'margin-block': 4 }]]);
  });

  it('compose a Room variant from the Spread class of the same size, which composes PhoneHit', async () => {
    const lists = await classLists('styles/PhoneHit.css.ts');
    const named = (list: string[], name: string) => list.filter((c) => c.includes(`_${name}__`));
    [26, 36].forEach((size) => {
      const room = lists[`PhoneHitRoom${size}`];
      expect(
        named(room, `PhoneHitSpread${size}`),
        `Room${size} composes Spread${size}`
      ).toHaveLength(1);
      expect(named(room, 'PhoneHit'), `Room${size} composes PhoneHit`).toHaveLength(1);
    });
    expect(lists.PhoneHitRoom36.some((c) => c.includes('_PhoneHitSpread26__'))).toBe(false);
  });

  it("make a message's reaction chip 44 px to tap by opening 9 px above and below it", async () => {
    const css = await emitted('components/message/Reaction.css.ts');
    const [chip] = rulesFor(css, /^button\.Reaction_Reaction__\w+$/, PHONE);
    expect(chip['margin-block']).toBe((TAP - 26) / 2);
    expect(css).toMatch(/::after \{[^}]*inset: -9px 0;/);
    rulesFor(css, /^button\.Reaction_Reaction__\w+$/, undefined).forEach((d) =>
      expect(Object.keys(d)).not.toContain('margin-block')
    );
  });

  it('give a sender name a 44 px wide button too, text kept at its start', async () => {
    const css = await emitted('components/message/layout/layout.css.ts');
    const [phone] = rulesFor(css, /^button\.layout_Username__/, PHONE);
    expect(phone['min-width']).toBe(TAP);
    expect(css).toMatch(/text-align: start;/);
  });
});

describe('icon buttons in the room view', () => {
  // The class each IconButton must carry, in source order: the variant is chosen by the button's drawn size
  // and whether a clipping container or neighbours surround it, so a swapped variant is a wrong hit area.
  const expected: Record<string, string[]> = {
    'features/room/message/Message.tsx': [
      'PhoneHitSpread32', // quick-reaction emoji buttons
      'PhoneHitSpread32', // delete dialog close
      'PhoneHitSpread32', // report dialog close
      ...Array(6).fill('PhoneHitRoom26'), // message options bar, inside a clipping menu
    ],
    'features/room/RoomInput.tsx': ['PhoneHitSpread24', ...Array(5).fill('PhoneHitSpread32')], // reply cancel is a 16 px icon, the rest 24 px
    'features/room/RoomViewHeader.tsx': Array(6).fill('PhoneHitSpread40'),
    // The chat path's other buttons. Two neighbours in a row: Spread32. One on its own: the plain PhoneHit.
    'features/room/message/MessageEditor.tsx': ['PhoneHitSpread32', 'PhoneHitSpread32'], // toolbar, emoji
    'features/room-nav/RoomNavItem.tsx': ['PhoneHitSpread24', 'PhoneHitSpread24'], // chat toggle, options: 16 px icon + 8 padding = 24 px, 0 gap
    'features/room/MembersDrawer.tsx': ['PhoneHit', 'PhoneHit'], // close, scroll to top
    'features/room/reaction-viewer/ReactionViewer.tsx': ['PhoneHit'],
    'features/room/room-pin-menu/RoomPinMenu.tsx': ['PhoneHitSpread26', 'PhoneHit'], // unpin (26 px, 8 px from the Open chip), close
    'features/room/RoomViewTyping.tsx': ['PhoneHit'],
    'features/room/CallChatView.tsx': ['PhoneHit'],
    'features/room/jump-to-time/JumpToTime.tsx': ['PhoneHit'],
    // Buttons that were fixed with #125 and had no test.
    'components/password-input/PasswordInput.tsx': ['PhoneHit'],
    'features/desk/Desk.tsx': ['PhoneHit'],
    'features/scene/SkyStateControl.tsx': ['PhoneHit'],
    'pages/auth/login/PasswordLoginForm.tsx': ['PhoneHit'],
  };

  // IconButtons whose drawn size the source does not say (file -> index in source order -> why). Everything else
  // is derived from the size props, so a Spread32 on a 24 px button fails.
  const sizeAllow: SizeAllow = {
    'features/room/message/Message.tsx': {
      0: 'quick-reaction button wraps an emoji <Text>, no Icon; 32 px by its CSS class',
    },
  };

  it.each(Object.entries(expected))(
    '%s: each IconButton carries its own PhoneHit class',
    (file, want) => expectPhoneHitClasses(file, want)
  );

  it.each(Object.keys(expected))('%s: each sized variant equals the px its button draws', (file) =>
    expectSizeTie(file, sizeAllow)
  );
});
