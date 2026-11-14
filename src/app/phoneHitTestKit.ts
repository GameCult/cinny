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

// The extension picks the script kind (.ts reads `<T>x` as an assertion, .tsx and .jsx read it as JSX).
const tsx = (src: string, fileName = 'source.tsx') =>
  ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true);

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const isTag = (n: ts.Node): n is Opening =>
  ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n);

/** Local names the source binds IconButton to by import: IconButton itself and any alias (IconButton as IB). */
const iconButtonNames = (sf: ts.SourceFile) => {
  const names = new Set(['IconButton']);
  sf.statements.forEach((st) => {
    const nb = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : undefined;
    if (nb && ts.isNamedImports(nb))
      nb.elements.forEach((e) => {
        if ((e.propertyName ?? e.name).text === 'IconButton') names.add(e.name.text);
      });
  });
  return names;
};

/** Whether a JSX tag name is an IconButton: the plain or aliased identifier, or a namespace member (<F.IconButton>). */
const isIconButtonTag = (tag: ts.JsxTagNameExpression, names: Set<string>) =>
  (ts.isIdentifier(tag) && names.has(tag.text)) ||
  (ts.isPropertyAccessExpression(tag) && tag.name.text === 'IconButton');

/** Every IconButton element (not IconButtonX) of a parsed source, in source order, however its tag is spelled. */
const elements = (sf: ts.SourceFile) => {
  const names = iconButtonNames(sf);
  const found: Opening[] = [];
  const walk = (n: ts.Node) => {
    if (isTag(n) && isIconButtonTag(n.tagName, names)) found.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return found;
};

/** Every mention of IconButton that is not a JSX tag or the import itself: passed as a value (as={IconButton}),
 * re-bound, re-exported, reached by destructuring or by an element access. Such a render cannot be tied to a
 * PhoneHit class, so each is reported ("line:col") and the guard fails on it. */
const unhandledMentions = (sf: ts.SourceFile) => {
  const names = iconButtonNames(sf);
  const out: string[] = [];
  const at = (n: ts.Node) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart());
    out.push(`${line + 1}:${character + 1}`);
  };
  const walk = (n: ts.Node) => {
    if (ts.isIdentifier(n) && names.has(n.text)) {
      const p = n.parent;
      const tagged = (x: ts.Node) =>
        (isTag(x) || ts.isJsxClosingElement(x)) && x.tagName === (n as ts.Node);
      const member =
        ts.isPropertyAccessExpression(p) &&
        p.name === n &&
        (isTag(p.parent) || ts.isJsxClosingElement(p.parent)) &&
        p.parent.tagName === p;
      if (!ts.isImportSpecifier(p) && !tagged(p) && !member) at(n);
    } else if (
      ts.isStringLiteralLike(n) &&
      n.text === 'IconButton' &&
      ts.isElementAccessExpression(n.parent)
    )
      at(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
};

const bodyOf = (el: Opening) =>
  ts.isJsxOpeningElement(el) && ts.isJsxElement(el.parent)
    ? el.getSourceFile().text.slice(el.end, el.parent.closingElement.getStart())
    : '';

/** Every <IconButton (not <IconButtonX): its opening tag and what it wraps (empty when self-closing). */
export const iconButtons = (src: string) =>
  elements(tsx(src)).map((el) => ({ tag: el.getText(), body: bodyOf(el) }));

export const iconButtonTags = (src: string) => iconButtons(src).map((b) => b.tag);

/** Local names the source imports as values from the PhoneHit.css module (as written, not aliased). An
 * `import type`, or a `type` specifier, binds no value and is not read. */
const importedHits = (sf: ts.SourceFile) =>
  new Set(
    sf.statements.flatMap((st) => {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) return [];
      const nb = st.importClause?.namedBindings;
      return nb &&
        !st.importClause?.isTypeOnly &&
        ts.isNamedImports(nb) &&
        /^(\.\.\/)+styles\/PhoneHit\.css$/.test(st.moduleSpecifier.text)
        ? nb.elements.filter((e) => !e.propertyName && !e.isTypeOnly).map((e) => e.name.text)
        : [];
    })
  );

const bindingNames = (b: ts.BindingName): string[] =>
  ts.isIdentifier(b)
    ? [b.text]
    : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)));

const declaresVar = (list: ts.VariableDeclarationList, name: string) =>
  list.declarations.some((d) => bindingNames(d.name).includes(name));

/** Whether `var name` is declared anywhere in a function body, outside nested functions (var hoists to the function). */
const hoistsVar = (fn: ts.Node, name: string) => {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found || (n !== fn && ts.isFunctionLike(n))) return;
    if (
      ts.isVariableDeclarationList(n) &&
      // eslint-disable-next-line no-bitwise -- NodeFlags is a bit set; var is the one declaration kind with neither flag
      (n.flags & ts.NodeFlags.BlockScoped) === 0 &&
      declaresVar(n, name)
    )
      found = true;
    ts.forEachChild(n, walk);
  };
  walk(fn);
  return found;
};

/** Whether one scope node declares `name` of its own: parameters, a function expression's own name, block-level
 * let/const/function/class, a for-loop head or a catch variable. */
const scopeDeclares = (scope: ts.Node, name: string): boolean => {
  const inStatements = (sts: readonly ts.Statement[]) =>
    sts.some(
      (st) =>
        (ts.isVariableStatement(st) && declaresVar(st.declarationList, name)) ||
        ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name)
    );
  if (ts.isBlock(scope) || ts.isModuleBlock(scope)) return inStatements(scope.statements);
  if (ts.isCaseBlock(scope)) return inStatements(scope.clauses.flatMap((c) => [...c.statements]));
  if (ts.isFunctionLike(scope))
    return (
      scope.parameters.some((p) => bindingNames(p.name).includes(name)) ||
      ((ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) &&
        scope.name?.text === name) ||
      hoistsVar(scope, name)
    );
  if (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope))
    return (
      !!scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer) &&
      declaresVar(scope.initializer, name)
    );
  if (ts.isCatchClause(scope))
    return (
      !!scope.variableDeclaration && bindingNames(scope.variableDeclaration.name).includes(name)
    );
  return false;
};

/** Whether an inner scope between the identifier and the module rebinds its name, so it is not the import. */
const shadowed = (id: ts.Identifier) => {
  for (let n: ts.Node | undefined = id.parent; n && !ts.isSourceFile(n); n = n.parent)
    if (scopeDeclares(n, id.text)) return true;
  return false;
};

const MERGERS = new Set(['classNames', 'clsx', 'cx']);

/** The PhoneHit* class an IconButton carries, or null. className must appear exactly once, with no props spread
 * after it (a spread can override it at runtime), and its expression must be: the bare identifier; a classNames /
 * clsx / cx call with it as a direct argument; or a template with it as a direct span. The identifier must occur
 * nowhere else in the expression, so a key, a member, a closure, a conditional or a comma can never carry it. When
 * `imported` is given, the identifier must also resolve to a value binding imported from the PhoneHit.css module
 * (not an `import type`, not rebound by an inner scope). */
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
    ts.isIdentifier(n) &&
    /^PhoneHit\w*$/.test(n.text) &&
    (!imported || (imported.has(n.text) && !shadowed(n)));
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

/** What a source file leaves uncovered: the indices (source order) of its IconButton elements without a PhoneHit
 * class, and the "line:col" of every mention of IconButton that is not a tag and so cannot be checked at all. The
 * fileName picks the parser (.ts, .tsx, .js, ...). */
export const uncoveredIconButtons = (src: string, fileName = 'source.tsx') => {
  const sf = tsx(src, fileName);
  const imported = importedHits(sf);
  return {
    bare: elements(sf).flatMap((el, i) => (hitOf(el, imported) === null ? [i] : [])),
    unhandled: unhandledMentions(sf),
  };
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
const sizeProp = (el: Opening) => {
  const props = el.attributes.properties;
  // props spread in may carry a size of their own
  if (props.some(ts.isJsxSpreadAttribute)) return undefined;
  const sizes = props.filter(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'size'
  );
  if (sizes.length === 0) return '400';
  const init = sizes[sizes.length - 1].initializer;
  const lit = init && ts.isJsxExpression(init) ? init.expression : init;
  return lit && ts.isStringLiteralLike(lit) ? lit.text : undefined;
};

/** The px an IconButton draws, from its size prop and the Icon inside; undefined with a reason when the source
 * does not say (a variable size, no Icon, Icons of different sizes). Both are read off the parsed tag and body. */
export const drawnPx = (tag: string, body: string): { px: number } | { undetermined: string } => {
  let button: Opening | undefined;
  const first = (n: ts.Node) => {
    if (!button && isTag(n)) button = n;
    else if (!button) ts.forEachChild(n, first);
  };
  first(tsx(tag.endsWith('/>') ? tag : `${tag}</x>`));
  const pad = BUTTON_PAD[(button && sizeProp(button)) ?? ''];
  if (pad === undefined)
    return { undetermined: 'size of the IconButton is not a literal (or props are spread in)' };
  const icons: (number | undefined)[] = [];
  const find = (n: ts.Node) => {
    if (isTag(n) && ts.isIdentifier(n.tagName) && n.tagName.text === 'Icon')
      icons.push(ICON_PX[sizeProp(n) ?? '']);
    ts.forEachChild(n, find);
  };
  find(tsx(`<>${body}</>`));
  if (icons.length === 0) return { undetermined: 'no <Icon> inside' };
  if (icons.some((p) => p === undefined))
    return { undetermined: 'size of an Icon is not a literal (or props are spread in)' };
  if (new Set(icons).size > 1) return { undetermined: 'Icons of different sizes inside' };
  return { px: (icons[0] as number) + 2 * pad };
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
