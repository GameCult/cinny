import { describe, expect, it } from 'vitest';
import zlib from 'zlib';
import { compile, processVanillaFile } from '@vanilla-extract/integration';
import { MOBILE_BREAKPOINT } from './hooks/useScreenSize';

// The CSS a .css.ts file emits, read back from vanilla-extract's own compile (as pages/auth/footerBand.test.ts does;
// vanilla-extract gzips the inlined source only when it is large, so both forms are read).
const emitted = async (file: string) => {
  const filePath = `${process.cwd()}/src/app/${file}`;
  const { source } = await compile({ filePath, cwd: process.cwd(), identOption: 'debug' });
  const code = await processVanillaFile({ source, filePath, identOption: 'debug' });
  // A file with recipes inlines one source per rule group; read them all.
  return [...code.matchAll(/source=#?([A-Za-z0-9+/=]+)/g)]
    .map((m) => {
      const bytes = Buffer.from(m[1], 'base64');
      return (bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes).toString();
    })
    .join('\n');
};

type Decls = Record<string, number>;
const parse = (body: string): Decls =>
  Object.fromEntries(
    body
      .split('\n')
      .map((l) => l.trim().replace(/;$/, ''))
      .filter((l) => /^[a-z-]+: -?\d+px$/.test(l))
      .map((l) => [l.split(':')[0], Number(l.split(': ')[1].replace('px', ''))])
  );

/** Pixel declarations of the rules whose selector matches, inside or outside a media query. */
const rulesFor = (css: string, selector: RegExp, media: string | undefined): Decls[] => {
  const scope = media
    ? [...css.matchAll(/@media ([^{]+) \{\n([\s\S]*?\n)\}(?:\n|$)/g)]
        .filter((m) => m[1] === media)
        .map((m) => m[2])
        .join('\n')
    : css.replace(/@media [^{]+ \{\n[\s\S]*?\n\}(?:\n|$)/g, '');
  return [...scope.matchAll(/^\s*([^{}\n]+) \{\n([^}]*)\}/gm)]
    .filter((m) => selector.test(m[1]))
    .map((m) => parse(m[2]));
};

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
    expect(css).toMatch(/::after \{[^}]*position: absolute;/);
    expect(stripPhone(css).trim()).toBe('');
  });

  it('open a row up by half the shortfall, so neighbouring hit areas meet and do not overlap', async () => {
    const css = await emitted('styles/PhoneHit.css.ts');
    const margins = (selector: RegExp) =>
      rulesFor(css, selector, PHONE).map((d) => d['margin-inline']);
    // 32 px composer buttons, 40 px header buttons, 26 px message-option buttons (which also open vertically,
    // the menu around them clips a hit area drawn outside its box)
    expect(margins(/PhoneHit_spread__/)).toEqual(expect.arrayContaining([9, 6, 2]));
    expect(rulesFor(css, /PhoneHit_PhoneHitRoom26__/, PHONE)).toEqual([{ 'margin-block': 9 }]);
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
