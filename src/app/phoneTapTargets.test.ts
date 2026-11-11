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
  const bytes = Buffer.from(
    (code.match(/source=#?([A-Za-z0-9+/=]+)/) as RegExpMatchArray)[1],
    'base64'
  );
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes).toString();
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

// [target, css file, selector, measured height in CSS px on the Starfire phone run (390x844)].
const targets: [string, string, RegExp, number][] = [
  [
    'sender-name button',
    'components/message/layout/layout.css.ts',
    /^button\.layout_Username__/,
    23,
  ],
  [
    'room-topic button',
    'features/room/RoomViewHeader.css.ts',
    /RoomViewHeader_HeaderTopic__\w+$/,
    18,
  ],
  ['sign-in card links', 'pages/auth/styles.css.ts', /styles_AuthCard__\w+ a$/, 16],
  ['sign-in footer links', 'pages/auth/styles.css.ts', /styles_AuthFooter__\w+ a$/, 22],
];

describe.each(targets)('phone tap target: %s', (_name, file, selector, height) => {
  it(`grows its hit area to ${TAP} px without moving layout`, async () => {
    const css = await emitted(file);
    const [phone] = rulesFor(css, selector, PHONE);
    expect(phone, 'a phone rule exists').toBeDefined();
    const top = phone['padding-top'] ?? phone['padding-block'];
    const bottom = phone['padding-bottom'] ?? phone['padding-block'];
    const marginTop = phone['margin-top'] ?? phone['margin-block'];
    const marginBottom = phone['margin-bottom'] ?? phone['margin-block'];
    expect(height + top + bottom).toBeGreaterThanOrEqual(TAP);
    // the margin takes back exactly what the padding added, so the target does not move or push its neighbours
    expect(marginTop).toBe(-top);
    expect(marginBottom).toBe(-bottom);
  });

  it('leaves every other screen as it was: no padding or margin outside the phone query', async () => {
    const css = await emitted(file);
    rulesFor(css, selector, undefined).forEach((decls) =>
      expect(Object.keys(decls).filter((k) => /^(padding|margin)/.test(k))).toEqual([])
    );
  });
});
