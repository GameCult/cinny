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
});
