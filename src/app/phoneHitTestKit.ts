// Shared helpers for the phone hit-area tests (phoneTapTargets.test.ts and one phoneHit.<group>.test.ts per later
// group of IconButtons). Not a test file: it registers nothing, the test files call it.
import { readFileSync } from 'fs';
import { expect } from 'vitest';
import zlib from 'zlib';
import { compile, processVanillaFile } from '@vanilla-extract/integration';

// The CSS a .css.ts file emits, read back from vanilla-extract's own compile (as pages/auth/footerBand.test.ts does;
// vanilla-extract gzips the inlined source only when it is large, so both forms are read).
export const emitted = async (file: string) => {
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

export type Decls = Record<string, number>;
const parse = (body: string): Decls =>
  Object.fromEntries(
    body
      .split('\n')
      .map((l) => l.trim().replace(/;$/, ''))
      .filter((l) => /^[a-z-]+: -?\d+px$/.test(l))
      .map((l) => [l.split(':')[0], Number(l.split(': ')[1].replace('px', ''))])
  );

/** Pixel declarations of the rules whose selector matches, inside or outside a media query. */
export const rulesFor = (css: string, selector: RegExp, media: string | undefined): Decls[] => {
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

/** The source of a file under src/app. */
export const readSource = (file: string) =>
  readFileSync(`${process.cwd()}/src/app/${file}`, 'utf8');

/** The end of a JSX opening tag starting at `from`: its closing > outside any {} expression. */
const tagEnd = (src: string, from: number) => {
  let depth = 0;
  let j = from;
  for (; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') depth -= 1;
    else if (src[j] === '>' && depth === 0) break;
  }
  return j;
};

/** The opening tag of every <IconButton in a source file, read to its closing > outside any {} expression. */
export const iconButtonTags = (src: string) => {
  const tags: string[] = [];
  for (let i = src.indexOf('<IconButton'); i !== -1; i = src.indexOf('<IconButton', i + 1)) {
    tags.push(src.slice(i, tagEnd(src, i) + 1));
  }
  return tags;
};

/** Every <IconButton: its opening tag and what it wraps (empty when self-closing). */
const iconButtons = (src: string) => {
  const out: { tag: string; body: string }[] = [];
  for (let i = src.indexOf('<IconButton'); i !== -1; i = src.indexOf('<IconButton', i + 1)) {
    const end = tagEnd(src, i);
    const tag = src.slice(i, end + 1);
    const close = src.indexOf('</IconButton>', end);
    out.push({ tag, body: tag.endsWith('/>') || close === -1 ? '' : src.slice(end + 1, close) });
  }
  return out;
};

const phoneHitOf = (tag: string) => tag.match(/className=\{[^}]*?\b(PhoneHit\w*)\b/)?.[1] ?? null;

/** The class each IconButton must carry, in source order: the variant is chosen by the button's drawn size and
 * whether a clipping container or neighbours surround it, so a swapped variant is a wrong hit area. Also checks
 * the name is the one PhoneHit.css.ts exports, not a local of the same name. */
export const expectPhoneHitClasses = (file: string, want: string[]) => {
  const src = readSource(file);
  expect(iconButtonTags(src).map(phoneHitOf)).toEqual(want);
  [...new Set(want)].forEach((name) =>
    expect(src).toMatch(
      new RegExp(
        `import \\{(?:[^}]*,)?\\s*${name}\\s*(?:,[^}]*)?\\} from '(\\.\\./)+styles/PhoneHit\\.css'`
      )
    )
  );
};

// IconButton `size` -> padding on each side, Icon `size` -> px (folds 2.7.2). Both default to 400.
const BUTTON_PAD: Record<string, number> = { '300': 4, '400': 8, '500': 12, '600': 16 };
const ICON_PX: Record<string, number> = {
  '50': 16,
  '100': 18,
  '200': 20,
  '300': 22,
  '400': 24,
  '500': 28,
};

/** The size prop of a tag: its literal value, the default when absent, or undefined when it is an expression. */
const sizeProp = (tag: string) => {
  const m = tag.match(/\ssize=(?:"(\w+)"|\{([^}]*)\})/);
  if (!m) return '400';
  return m[1] ?? m[2].match(/^'(\w+)'$/)?.[1];
};

/** The px an IconButton draws, from its size prop and the Icon inside; undefined with a reason when the source
 * does not say (a variable size, no Icon, Icons of different sizes). */
export const drawnPx = (tag: string, body: string): { px: number } | { undetermined: string } => {
  const pad = BUTTON_PAD[sizeProp(tag) ?? ''];
  if (pad === undefined) return { undetermined: 'size of the IconButton is not a literal' };
  const icons = [...body.matchAll(/<Icon\b/g)].map((m) => {
    const t = body.slice(m.index, tagEnd(body, m.index ?? 0) + 1);
    return ICON_PX[sizeProp(t) ?? ''];
  });
  if (icons.length === 0) return { undetermined: 'no <Icon> inside' };
  if (icons.some((p) => p === undefined))
    return { undetermined: 'size of an Icon is not a literal' };
  if (new Set(icons).size > 1) return { undetermined: 'Icons of different sizes inside' };
  return { px: icons[0] + 2 * pad };
};

/** Per file, per IconButton index (source order): why its drawn size cannot be derived from the source. */
export type SizeAllow = Record<string, Record<number, string>>;

/** A button carrying PhoneHitSpread<N> or PhoneHitRoom<N> draws N px. Plain PhoneHit has no number to tie. An
 * undetermined size passes only with an entry in `allow`, and an entry for a size that can be derived fails. */
export const expectSizeTie = (file: string, allow: SizeAllow = {}) => {
  const allowed = allow[file] ?? {};
  const seen = new Set<number>();
  iconButtons(readSource(file)).forEach(({ tag, body }, i) => {
    const variant = phoneHitOf(tag)?.match(/^PhoneHit(?:Spread|Room)(\d+)$/);
    if (!variant) {
      expect(allowed[i], `${file} #${i} is allow-listed but has no sized variant`).toBeUndefined();
      return;
    }
    const drawn = drawnPx(tag, body);
    if ('undetermined' in drawn) {
      expect(
        allowed[i],
        `${file} #${i}: ${drawn.undetermined}; add it to the allow-list`
      ).toBeDefined();
      seen.add(i);
      return;
    }
    expect(allowed[i], `${file} #${i} is allow-listed but its size is derivable`).toBeUndefined();
    expect(Number(variant[1]), `${file} #${i} draws ${drawn.px} px`).toBe(drawn.px);
  });
  expect(Object.keys(allowed).map(Number).sort()).toEqual([...seen].sort());
};
