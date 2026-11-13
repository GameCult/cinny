import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT } from './hooks/useScreenSize';
import { emitted } from './phoneHitTestKit';
import { ICON_BUTTON_CLASS, PHONE_GLYPHS } from '../phoneGlyph.css';

const foldsJs = readFileSync(`${process.cwd()}/node_modules/folds/dist/index.js`, 'utf8');
const foldsCss = readFileSync(`${process.cwd()}/node_modules/folds/dist/style.css`, 'utf8');

/** The px folds draws an Icon class at: its width variable's rem value, at the 16 px root. */
const foldsPx = (cls: string) => {
  const v = foldsCss.match(new RegExp(`\\.${cls} \\{\\s*width: var\\((--[\\w-]+)\\)`))?.[1];
  const rem = v && foldsCss.match(new RegExp(`${v}: ([\\d.]+)rem`))?.[1];
  return rem ? Number(rem) * 16 : undefined;
};

describe('phone glyphs inside IconButtons', () => {
  it("name folds' own classes: the IconButton base class and one Icon class per size", () => {
    expect(foldsJs).toContain(
      `var IconButton$1 = createRuntimeFn({ defaultClassName: "${ICON_BUTTON_CLASS} `
    );
    const iconSizes = foldsJs.match(
      /var Icon\$1 = createRuntimeFn\(\{[^\n]*variantClassNames: \{ size: \{([^}]*)\}/
    )?.[1];
    expect(iconSizes).toBeDefined();
    Object.entries(PHONE_GLYPHS).forEach(([size, { cls }]) =>
      expect(iconSizes).toContain(`"${size}": "${cls}"`)
    );
  });

  it("start from the px folds draws each Icon size at (the scale's divisor is not a guess)", () =>
    Object.values(PHONE_GLYPHS).forEach(({ cls, px }) => expect(foldsPx(cls)).toBe(px)));

  it('draw the folds Icon px (16 18 20 22 24) at 22..28 px, never smaller, never past the smallest button box', () => {
    // folds IconButton padding is 4 px a side at the smallest size, so its box is the glyph plus 8.
    Object.values(PHONE_GLYPHS).forEach(({ px, phonePx }) => {
      expect(phonePx).toBeGreaterThanOrEqual(22);
      expect(phonePx).toBeLessThanOrEqual(28);
      expect(phonePx).toBeGreaterThan(px);
      expect(phonePx).toBeLessThanOrEqual(px + 8);
    });
  });

  it('are a paint-time scale on phones only: no size, margin or padding, and no rule outside the phone query', async () => {
    const css = await emitted('../phoneGlyph.css.ts');
    const phone = `@media screen and (max-width: ${MOBILE_BREAKPOINT}px)`;
    expect(
      css.replace(new RegExp(`${phone.replace(/[()]/g, '\\$&')} \\{\\n[\\s\\S]*?\\n\\}`, 'g'), '')
    ).not.toMatch(/\.brs7ce5/);
    Object.entries(PHONE_GLYPHS).forEach(([size, { cls, px, phonePx }]) => {
      const rule = css.match(
        new RegExp(`\\.${ICON_BUTTON_CLASS} > \\.${cls} \\{\\n([^}]*)\\}`)
      )?.[1];
      expect(rule, `rule for Icon size ${size}`).toBeDefined();
      expect(
        rule!
          .trim()
          .split('\n')
          .map((l) => l.trim().split(':')[0])
      ).toEqual(['scale']);
      expect(Number(rule!.match(/scale: ([\d.]+)/)![1])).toBeCloseTo(phonePx / px, 6);
    });
  });
});
