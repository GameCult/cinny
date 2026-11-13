import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { relative } from 'path';
import {
  drawnPx,
  expectPhoneHitClasses,
  expectSizeTie,
  iconButtons,
  phoneHitOf,
  uncoveredIconButtons,
} from './phoneHitTestKit';

describe('phone hit test kit', () => {
  it('reads <IconButton only, not a longer component name', () => {
    const src =
      '<IconButtonGroup><IconButton size="300"><Icon /></IconButton><IconButton\n/></IconButtonGroup>';
    expect(iconButtons(src).map((b) => b.tag)).toEqual([
      '<IconButton size="300">',
      '<IconButton\n/>',
    ]);
  });

  it('derives a drawn size from literal size props, defaults being 400', () => {
    expect(drawnPx('<IconButton size="300">', '<Icon size="50" />')).toEqual({ px: 24 });
    expect(drawnPx('<IconButton>', '<Icon />')).toEqual({ px: 40 });
  });

  it('reads <Icon only, not a longer component name', () => {
    expect(
      drawnPx('<IconButton size="300">', '<IconBadge size="100" /><Icon size="50" />')
    ).toEqual({
      px: 24,
    });
  });

  it('calls a size undetermined when props are spread into the IconButton or the Icon', () => {
    expect(drawnPx('<IconButton {...props}>', '<Icon size="50" />')).toHaveProperty('undetermined');
    expect(drawnPx('<IconButton size="300" {...props}>', '<Icon />')).toHaveProperty(
      'undetermined'
    );
    expect(drawnPx('<IconButton size="300">', '<Icon {...iconProps} />')).toHaveProperty(
      'undetermined'
    );
    expect(drawnPx('<IconButton size={size}>', '<Icon />')).toHaveProperty('undetermined');
  });

  it('fails a file with no IconButton, which would otherwise pass vacuously', () => {
    expect(() => expectSizeTie('styles/PhoneHit.css.ts')).toThrow(/no IconButton/);
  });

  describe('phoneHitOf reads the imported class off the AST, applied unconditionally', () => {
    const tag = (expr: string) => `<IconButton size="300" className={${expr}}>`;
    const ok = (expr: string, name: string) => expect(phoneHitOf(tag(expr))).toBe(name);
    const no = (expr: string) => expect(phoneHitOf(tag(expr))).toBeNull();

    it('accepts the bare identifier and merges that always include it', () => {
      ok('PhoneHitSpread26', 'PhoneHitSpread26');
      ok('classNames(PhoneHitRoom36, css.other)', 'PhoneHitRoom36');
      ok('clsx(css.a, { [css.b]: on }, PhoneHit)', 'PhoneHit');
      ok('cx(PhoneHit)', 'PhoneHit');
      ok('`${PhoneHit} ${css.other}`', 'PhoneHit');
      ok('classNames(/* PhoneHit */ PhoneHit)', 'PhoneHit');
    });

    it('rejects the name as a string, a concatenation or a comment', () => {
      no("'PhoneHitSpread26'");
      no('`PhoneHitSpread26`');
      no('"PhoneHitSpread26" + "x"');
      no("'PhoneHit' + 'Spread26'");
      no('/* PhoneHit */ undefined');
      no('css.a // PhoneHit');
    });

    it('rejects a conditionally applied name', () => {
      no('cond ? PhoneHitSpread26 : undefined');
      no('cond && PhoneHitSpread26');
      no('cond || PhoneHitSpread26');
      no('maybe ?? PhoneHitSpread26');
      no("classNames(cond ? PhoneHit : '', css.a)");
      no('classNames(PhoneHit, cond && PhoneHit)');
    });

    it('rejects every other expression shape the name can hide in', () => {
      no('classNames({ PhoneHit: on })');
      no('clsx({ [PhoneHit]: on })');
      no('`${`${PhoneHit}`}`');
      no('typeof PhoneHit');
      no("(PhoneHit = 'x')");
      no('(PhoneHit, css.a)');
      no('(PhoneHit)');
      no('() => PhoneHit');
      no('PhoneHit.foo');
      no('other.PhoneHit');
      no('classNames(css.a, [PhoneHit])');
      no('wrap(PhoneHit)');
      no('PhoneHitSpread26é');
      no('`${css.a}`');
    });

    it('rejects a tag without className, with two, or with a non-expression one', () => {
      expect(phoneHitOf('<IconButton size="300">')).toBeNull();
      expect(phoneHitOf('<IconButton className={PhoneHit} className={css.a}>')).toBeNull();
      expect(phoneHitOf('<IconButton className="PhoneHit">')).toBeNull();
      expect(phoneHitOf('<IconButton className={PhoneHit} />')).toBe('PhoneHit');
    });

    it('rejects a spread after className, which can override it, and accepts one before', () => {
      expect(phoneHitOf('<IconButton className={PhoneHit} {...props}>')).toBeNull();
      expect(phoneHitOf('<IconButton className={PhoneHit} size="300" {...props} />')).toBeNull();
      expect(phoneHitOf('<IconButton {...props} className={PhoneHit}>')).toBe('PhoneHit');
    });

    it('reads a className past braces inside strings', () => {
      ok("classNames('{', PhoneHit)", 'PhoneHit');
    });
  });

  describe('expectPhoneHitClasses', () => {
    const check = (src: string, want: (string | null)[]) => {
      const dir = mkdtempSync(`${tmpdir()}/phone-hit-kit-`);
      try {
        writeFileSync(`${dir}/Probe.tsx`, src);
        expectPhoneHitClasses(relative(`${process.cwd()}/src/app`, `${dir}/Probe.tsx`), want);
      } finally {
        rmSync(dir, { recursive: true });
      }
    };
    const imp = "import { PhoneHit, PhoneHitSpread26 } from '../../styles/PhoneHit.css';\n";
    const src =
      imp +
      'const A = () => (<><IconButton className={PhoneHit} /><IconButton className={classNames(PhoneHitSpread26, a)} /><IconButton /></>);';

    it('pins each button in order, null meaning no class', () => {
      check(src, ['PhoneHit', 'PhoneHitSpread26', null]);
      expect(() => check(src, ['PhoneHit', 'PhoneHit', null])).toThrow();
      expect(() => check(src, ['PhoneHit', 'PhoneHitSpread26', 'PhoneHit'])).toThrow();
      expect(() => check(src, ['PhoneHit', 'PhoneHitSpread26'])).toThrow();
    });

    it('fails a name that is not read from PhoneHit.css or is applied conditionally', () => {
      const local = "const PhoneHit = 'x';\n<IconButton className={PhoneHit} />";
      expect(() => check(local, ['PhoneHit'])).toThrow();
      expect(() => check(local, [null])).not.toThrow();
      const cond = imp + '<IconButton className={on ? PhoneHit : undefined} />';
      expect(() => check(cond, ['PhoneHit'])).toThrow();
      const aliased =
        "import { Other as PhoneHit } from '../../styles/PhoneHit.css';\n<IconButton className={PhoneHit} />";
      expect(() => check(aliased, ['PhoneHit'])).toThrow();
      const wrongModule =
        "import { PhoneHit } from './other';\n<IconButton className={PhoneHit} />";
      expect(() => check(wrongModule, ['PhoneHit'])).toThrow();
    });
  });

  describe('uncoveredIconButtons: the coverage guard is not blind to a spelling of IconButton', () => {
    const imp = "import { PhoneHit } from '../styles/PhoneHit.css';\n";
    const none = { bare: [], unhandled: [] };

    it('sees an IconButton imported under an alias, as a tag', () => {
      const bare = "import { IconButton as IB } from 'folds';\nconst A = () => <IB />;";
      expect(uncoveredIconButtons(bare)).toEqual({ bare: [0], unhandled: [] });
      const ok = `${imp}import { IconButton as IB } from 'folds';\nconst A = () => <IB className={PhoneHit} />;`;
      expect(uncoveredIconButtons(ok)).toEqual(none);
    });

    it('sees a namespace member tag', () => {
      const bare = "import * as F from 'folds';\nconst A = () => <F.IconButton />;";
      expect(uncoveredIconButtons(bare)).toEqual({ bare: [0], unhandled: [] });
      const ok = `${imp}import * as F from 'folds';\nconst A = () => <F.IconButton className={PhoneHit}></F.IconButton>;`;
      expect(uncoveredIconButtons(ok)).toEqual(none);
    });

    it('fails loudly on an IconButton passed or bound as a value, and on a re-export', () => {
      const asProp =
        "import { IconButton } from 'folds';\nconst A = () => <Box as={IconButton} />;";
      expect(uncoveredIconButtons(asProp).unhandled).toEqual(['2:26']);
      const aliasValue =
        "import { IconButton as IB } from 'folds';\nconst A = () => <Box as={IB} />;";
      expect(uncoveredIconButtons(aliasValue).unhandled).toEqual(['2:26']);
      const rebound = "import { IconButton } from 'folds';\nconst B = IconButton;";
      expect(uncoveredIconButtons(rebound).unhandled).toEqual(['2:11']);
      const destructured = "import * as F from 'folds';\nconst { IconButton: IB } = F;";
      expect(uncoveredIconButtons(destructured).unhandled).toEqual(['2:9']);
      const member = "import * as F from 'folds';\nconst B = F.IconButton;";
      expect(uncoveredIconButtons(member).unhandled).toEqual(['2:13']);
      const indexed = "import * as F from 'folds';\nconst B = F['IconButton'];";
      expect(uncoveredIconButtons(indexed).unhandled).toEqual(['2:13']);
      expect(uncoveredIconButtons("export { IconButton } from 'folds';").unhandled).toHaveLength(1);
    });

    it('reads a non-.tsx file by its extension', () => {
      const ts =
        "import { IconButton } from 'folds';\nexport const x = <T,>(v: T) => <IconButton />;";
      expect(uncoveredIconButtons(ts, 'x.tsx').bare).toEqual([0]);
      const js = "import { IconButton } from 'folds';\nexport const B = IconButton;";
      expect(uncoveredIconButtons(js, 'x.ts').unhandled).toEqual(['2:18']);
      expect(uncoveredIconButtons(js, 'x.js').unhandled).toEqual(['2:18']);
      const jsx = "import { IconButton } from 'folds';\nexport const A = () => <IconButton />;";
      expect(uncoveredIconButtons(jsx, 'x.jsx').bare).toEqual([0]);
    });

    it('does not count IconButtonX, a comment or a string as an IconButton', () => {
      const src =
        "import { IconButtonGroup } from 'folds';\n// IconButton\nconst a = 'IconButton';\nconst A = () => <IconButtonGroup />;";
      expect(uncoveredIconButtons(src)).toEqual(none);
    });

    it('does not count a PhoneHit that an inner scope rebinds', () => {
      const tag = '<IconButton className={PhoneHit} />';
      const cases = [
        `const A = (PhoneHit) => ${tag};`,
        `const A = ({ PhoneHit }) => ${tag};`,
        `const A = ([a, PhoneHit]) => ${tag};`,
        `function A() { const PhoneHit = 'x'; return ${tag}; }`,
        `function A() { return ${tag}; var PhoneHit; }`,
        `function A() { if (a) { var PhoneHit = 'x'; } return ${tag}; }`,
        `function A() { { let { PhoneHit } = o; return ${tag}; } }`,
        `function A() { function PhoneHit() {} return ${tag}; }`,
        `function A() { for (const PhoneHit of xs) { return ${tag}; } }`,
        `function A() { try { f(); } catch (PhoneHit) { return ${tag}; } }`,
        `const A = function PhoneHit() { return ${tag}; };`,
        `function A() { switch (x) { case 1: const PhoneHit = 'x'; return ${tag}; } }`,
      ];
      cases.forEach((c) => expect(uncoveredIconButtons(`${imp}${c}`).bare, c).toEqual([0]));
      // the same shapes without the rebinding count, and a rebinding that is not in scope does not hide it
      expect(uncoveredIconButtons(`${imp}const A = () => ${tag};`).bare).toEqual([]);
      expect(
        uncoveredIconButtons(`${imp}const f = (PhoneHit) => 1;\nconst A = () => ${tag};`).bare
      ).toEqual([]);
      expect(uncoveredIconButtons(`${imp}function A() { return ${tag}; }`).bare).toEqual([]);
    });

    it('does not count an import type of PhoneHit', () => {
      const tag = 'const A = () => <IconButton className={PhoneHit} />;';
      const typeOnly = `import type { PhoneHit } from '../styles/PhoneHit.css';\n${tag}`;
      expect(uncoveredIconButtons(typeOnly).bare).toEqual([0]);
      const typeSpecifier = `import { type PhoneHit } from '../styles/PhoneHit.css';\n${tag}`;
      expect(uncoveredIconButtons(typeSpecifier).bare).toEqual([0]);
      expect(uncoveredIconButtons(`${imp}${tag}`).bare).toEqual([]);
    });
  });

  describe('drawnPx reads the parsed tag, not its text', () => {
    it('ignores a size in a string, comment or other prop name', () => {
      expect(drawnPx('<IconButton title=" size=\'500\'">', '<Icon />')).toEqual({ px: 40 });
      expect(drawnPx('<IconButton data-size="600" iconSize="500">', '<Icon />')).toEqual({
        px: 40,
      });
      expect(
        drawnPx('<IconButton size="300">', '{/* <Icon size="500" /> */}<Icon size="50" />')
      ).toEqual({
        px: 24,
      });
      expect(drawnPx('<IconButton size="300">', '{"<Icon size=\'500\' />"}')).toHaveProperty(
        'undetermined'
      );
    });

    it('reads a size from a braced string, and the last size wins', () => {
      expect(drawnPx("<IconButton size={'300'}>", '<Icon size={"50"} />')).toEqual({ px: 24 });
      expect(drawnPx('<IconButton size="300" size="500">', '<Icon size="50" />')).toEqual({
        px: 40,
      });
    });

    it('reads an Icon spread after a size, and a size past a braced prop with a > inside', () => {
      expect(drawnPx('<IconButton onClick={() => a > b} size="300">', '<Icon />')).toEqual({
        px: 32,
      });
      expect(drawnPx('<IconButton size="300">', '<Icon size="50" {...p} />')).toHaveProperty(
        'undetermined'
      );
    });
  });
});
