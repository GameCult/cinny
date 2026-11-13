import { describe, expect, it } from 'vitest';
import { drawnPx, expectSizeTie, iconButtons, phoneHitOf } from './phoneHitTestKit';

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

  describe('phoneHitOf reads the imported class, applied unconditionally', () => {
    const tag = (expr: string) => `<IconButton size="300" className={${expr}}>`;

    it('accepts the bare identifier and merges that always include it', () => {
      expect(phoneHitOf(tag('PhoneHitSpread26'))).toBe('PhoneHitSpread26');
      expect(phoneHitOf(tag('classNames(PhoneHitRoom36, css.other)'))).toBe('PhoneHitRoom36');
      expect(phoneHitOf(tag('`${PhoneHit} ${css.other}`'))).toBe('PhoneHit');
      expect(phoneHitOf(tag("[PhoneHit, 'a b'].join(' ')"))).toBe('PhoneHit');
      expect(phoneHitOf(tag('classNames(css.a, { [css.b]: on }, PhoneHit)'))).toBe('PhoneHit');
    });

    it('rejects the name as a string literal', () => {
      expect(phoneHitOf(tag("'PhoneHitSpread26'"))).toBeNull();
      expect(phoneHitOf(tag('`PhoneHitSpread26`'))).toBeNull();
    });

    it('rejects a name built by concatenation', () => {
      expect(phoneHitOf(tag('"PhoneHitSpread26" + "x"'))).toBeNull();
      expect(phoneHitOf(tag("'PhoneHit' + 'Spread26'"))).toBeNull();
    });

    it('rejects a conditionally applied name', () => {
      expect(phoneHitOf(tag('cond ? PhoneHitSpread26 : undefined'))).toBeNull();
      expect(phoneHitOf(tag('cond && PhoneHitSpread26'))).toBeNull();
      expect(phoneHitOf(tag('cond || PhoneHitSpread26'))).toBeNull();
      expect(phoneHitOf(tag('maybe ?? PhoneHitSpread26'))).toBeNull();
      expect(phoneHitOf(tag("classNames(cond ? PhoneHit : '', css.a)"))).toBeNull();
    });

    it('rejects a member of another object and a tag without className', () => {
      expect(phoneHitOf(tag('other.PhoneHit'))).toBeNull();
      expect(phoneHitOf('<IconButton size="300">')).toBeNull();
    });

    it('rejects a spread after className, which can override it, and accepts one before', () => {
      expect(phoneHitOf('<IconButton className={PhoneHit} {...props}>')).toBeNull();
      expect(phoneHitOf('<IconButton className={PhoneHit} size="300" {...props} />')).toBeNull();
      expect(phoneHitOf('<IconButton {...props} className={PhoneHit}>')).toBe('PhoneHit');
    });

    it('reads a className past braces inside strings', () => {
      expect(phoneHitOf(tag("classNames('{', PhoneHit)"))).toBe('PhoneHit');
    });
  });
});
