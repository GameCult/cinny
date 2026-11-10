import { describe, expect, it } from 'vitest';
import zlib from 'zlib';
import { compile, processVanillaFile } from '@vanilla-extract/integration';
import { AuthFooter } from './styles.css';

// The CSS styles.css.ts emits for the sign-in footer, read back from vanilla-extract's own compile.
const emitted = async () => {
  const filePath = `${process.cwd()}/src/app/pages/auth/styles.css.ts`;
  const { source } = await compile({ filePath, cwd: process.cwd(), identOption: 'debug' });
  const code = await processVanillaFile({ source, filePath, identOption: 'debug' });
  const encoded = (code.match(/source=#([A-Za-z0-9+/=]+)/) as RegExpMatchArray)[1];
  return zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString();
};
const declarations = (css: string, selector: string) =>
  [...css.matchAll(/^([^{}\n]+) \{\n([^}]*)\}/gm)]
    .filter((m) => m[1] === selector)
    .map((m) =>
      m[2]
        .split('\n')
        .map((l) => l.trim().replace(/;$/, ''))
        .filter(Boolean)
    );

describe('the sign-in footer band, as emitted', () => {
  const over = `:root[data-scene] .${AuthFooter}`;

  it('is one rule over the scene, so no later rule can override its mask', async () => {
    expect(declarations(await emitted(), over)).toHaveLength(1);
  });

  it('puts the plate fill before the color-mix tint, so a browser without color-mix keeps the fill', async () => {
    const [rule] = declarations(await emitted(), over);
    const fills = rule.filter((d) => d.startsWith('background-color:'));
    expect(fills).toHaveLength(2);
    expect(fills[0]).toBe('background-color: var(--sky-bubble, #0d1a26)');
    expect(fills[1]).toContain('color-mix(');
  });

  it('blurs what is behind it by 12px, the radius of the chat bubbles', async () => {
    const [rule] = declarations(await emitted(), over);
    expect(rule.filter((d) => d.startsWith('backdrop-filter'))).toEqual([
      'backdrop-filter: blur(12px)',
    ]);
  });

  it('declares exactly these properties, so nothing else (a shadow, a prefixed override) rides along', async () => {
    const [rule] = declarations(await emitted(), over);
    expect(rule.map((d) => d.slice(0, d.indexOf(':'))).sort()).toEqual([
      'backdrop-filter',
      'background-color',
      'background-color',
      'color',
      'mask-composite',
      'mask-image',
      'padding-bottom',
      'padding-top',
    ]);
  });

  it('fades along both axes over a soft ramp, not a hard edge', async () => {
    const [rule] = declarations(await emitted(), over);
    const mask = rule.find((d) => d.startsWith('mask-image:')) ?? '';
    expect(rule).toContain('mask-composite: intersect');
    ['bottom', 'right'].forEach((axis) => {
      const ramp = mask.match(
        new RegExp(
          `linear-gradient\\(to ${axis}, transparent, #000 (\\d+)px, #000 calc\\(100% - (\\d+)px\\), transparent\\)`
        )
      );
      expect(ramp).not.toBeNull();
      // Each end ramps from clear to opaque over at least 8px.
      expect(Number(ramp?.[1])).toBeGreaterThanOrEqual(8);
      expect(Number(ramp?.[2])).toBeGreaterThanOrEqual(8);
    });
  });

  it('has no border or radius, in the scene rule or in the base footer rule', async () => {
    const css = await emitted();
    const [rule] = declarations(css, over);
    const base = declarations(css, `.${AuthFooter}`);
    expect(base).toHaveLength(1);
    [rule, base[0]].forEach((r) => {
      expect(r.filter((d) => /^(border|outline)/.test(d))).toEqual([]);
    });
    // The base rule is only the footer's padding: nothing visible (a shadow, a fill) is hidden outside the scene rule.
    expect(base[0].map((d) => d.slice(0, d.indexOf(':')))).toEqual(['padding']);
  });
});
