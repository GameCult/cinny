// Shared helpers for the phone hit-area tests (phoneTapTargets.test.ts and one phoneHit.<group>.test.ts per later
// group of IconButtons). Not a test file: it registers nothing, the test files call it.
import { readFileSync } from 'fs';
import { expect } from 'vitest';
import ts from 'typescript';
import zlib from 'zlib';
import { compile, processVanillaFile } from '@vanilla-extract/integration';

// The CSS a .css.ts file emits, read back from vanilla-extract's own compile (as pages/auth/footerBand.test.ts does;
// vanilla-extract gzips the inlined source only when it is large, so both forms are read).
const compiled = async (file: string) => {
  const filePath = `${process.cwd()}/src/app/${file}`;
  const { source } = await compile({ filePath, cwd: process.cwd(), identOption: 'debug' });
  return processVanillaFile({ source, filePath, identOption: 'debug' });
};

/** The class list each export of a .css.ts file resolves to (a composed class lists the classes it composes). */
export const classLists = async (file: string): Promise<Record<string, string[]>> =>
  Object.fromEntries(
    [...(await compiled(file)).matchAll(/^export var (\w+) = '([^']*)';$/gm)].map((m) => [
      m[1],
      m[2].split(' '),
    ])
  );

export const emitted = async (file: string) => {
  const code = await compiled(file);
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

const tsx = (src: string) =>
  ts.createSourceFile('source.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/** Every IconButton element (not IconButtonX) of a parsed source, in source order. */
const elements = (sf: ts.SourceFile) => {
  const found: Opening[] = [];
  const walk = (n: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      ts.isIdentifier(n.tagName) &&
      n.tagName.text === 'IconButton'
    )
      found.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return found;
};

const bodyOf = (el: Opening) =>
  ts.isJsxOpeningElement(el) && ts.isJsxElement(el.parent)
    ? el.getSourceFile().text.slice(el.end, el.parent.closingElement.getStart())
    : '';

/** Every <IconButton (not <IconButtonX): its opening tag and what it wraps (empty when self-closing). */
export const iconButtons = (src: string) =>
  elements(tsx(src)).map((el) => ({ tag: el.getText(), body: bodyOf(el) }));

export const iconButtonTags = (src: string) => iconButtons(src).map((b) => b.tag);

/** Local names the source imports from the PhoneHit.css module (as written, not aliased). */
const importedHits = (sf: ts.SourceFile) =>
  new Set(
    sf.statements.flatMap((st) => {
      const nb = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : undefined;
      return nb &&
        ts.isNamedImports(nb) &&
        ts.isStringLiteral((st as ts.ImportDeclaration).moduleSpecifier) &&
        /^(\.\.\/)+styles\/PhoneHit\.css$/.test(
          ((st as ts.ImportDeclaration).moduleSpecifier as ts.StringLiteral).text
        )
        ? nb.elements.filter((e) => !e.propertyName).map((e) => e.name.text)
        : [];
    })
  );

const MERGERS = new Set(['classNames', 'clsx', 'cx']);

/** The PhoneHit* class an IconButton carries, or null. className must appear exactly once, with no props spread
 * after it (a spread can override it at runtime), and its expression must be: the bare identifier; a classNames /
 * clsx / cx call with it as a direct argument; or a template with it as a direct span. The identifier must occur
 * nowhere else in the expression, so a key, a member, a closure, a conditional or a comma can never carry it. When
 * `imported` is given, the identifier must also be a binding imported from the PhoneHit.css module. */
const hitOf = (el: Opening, imported?: Set<string>): string | null => {
  const props = el.attributes.properties;
  const at = props.flatMap((p, i) =>
    ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'className' ? [i] : []
  );
  if (at.length !== 1 || props.slice(at[0] + 1).some(ts.isJsxSpreadAttribute)) return null;
  const attr = props[at[0]] as ts.JsxAttribute;
  const expr =
    attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression;
  if (!expr) return null;
  const isHit = (n: ts.Node): n is ts.Identifier =>
    ts.isIdentifier(n) && /^PhoneHit\w*$/.test(n.text) && (!imported || imported.has(n.text));
  let direct: ts.Node[] = [];
  if (ts.isIdentifier(expr)) direct = [expr];
  else if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    MERGERS.has(expr.expression.text)
  )
    direct = [...expr.arguments];
  else if (ts.isTemplateExpression(expr)) direct = expr.templateSpans.map((sp) => sp.expression);
  const hits = direct.filter(isHit);
  if (hits.length !== 1) return null;
  let occurrences = 0;
  const count = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === hits[0].text) occurrences += 1;
    ts.forEachChild(n, count);
  };
  count(expr);
  return occurrences === 1 ? hits[0].text : null;
};

/** The PhoneHit* class of one tag's text (see hitOf), without the import-binding check. */
export const phoneHitOf = (tag: string) => {
  const els = elements(tsx(tag.endsWith('/>') ? tag : `${tag}</IconButton>`));
  return els.length === 1 ? hitOf(els[0]) : null;
};

/** The PhoneHit* class of each IconButton of a source, in source order; null when it has none or the name is not
 * the one imported from PhoneHit.css. */
export const phoneHitClasses = (src: string) => {
  const sf = tsx(src);
  const imported = importedHits(sf);
  return elements(sf).map((el) => hitOf(el, imported));
};

/** The class each IconButton must carry, in source order (null = must carry none): the variant is chosen by the
 * button's drawn size and whether a clipping container or neighbours surround it, so a swapped variant is a wrong
 * hit area. The name must also be the one PhoneHit.css exports, not a local of the same name. */
export const expectPhoneHitClasses = (file: string, want: (string | null)[]) =>
  expect(phoneHitClasses(readSource(file))).toEqual(want);

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
  // props spread in may carry a size of their own
  if (tag.includes('{...')) return undefined;
  const m = tag.match(/\ssize=(?:"(\w+)"|\{([^}]*)\})/);
  if (!m) return '400';
  return m[1] ?? m[2].match(/^'(\w+)'$/)?.[1];
};

/** The px an IconButton draws, from its size prop and the Icon inside; undefined with a reason when the source
 * does not say (a variable size, no Icon, Icons of different sizes). */
export const drawnPx = (tag: string, body: string): { px: number } | { undetermined: string } => {
  const pad = BUTTON_PAD[sizeProp(tag) ?? ''];
  if (pad === undefined)
    return { undetermined: 'size of the IconButton is not a literal (or props are spread in)' };
  const icons = [...body.matchAll(/<Icon(?=[\s>/])/g)].map((m) => {
    const t = body.slice(m.index, tagEnd(body, m.index ?? 0) + 1);
    return ICON_PX[sizeProp(t) ?? ''];
  });
  if (icons.length === 0) return { undetermined: 'no <Icon> inside' };
  if (icons.some((p) => p === undefined))
    return { undetermined: 'size of an Icon is not a literal (or props are spread in)' };
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
  const src = readSource(file);
  const buttons = iconButtons(src);
  const classes = phoneHitClasses(src);
  expect(buttons.length, `${file} has no IconButton`).toBeGreaterThan(0);
  buttons.forEach(({ tag, body }, i) => {
    const variant = classes[i]?.match(/^PhoneHit(?:Spread|Room)(\d+)$/);
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
