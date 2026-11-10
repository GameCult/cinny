import { describe, expect, it } from 'vitest';
import zlib from 'zlib';
import { compile, processVanillaFile } from '@vanilla-extract/integration';
import { AuthFooter } from './styles.css';

// The CSS styles.css.ts emits for the sign-in footer, read back from vanilla-extract's own compile.
const emitted = async () => {
  const filePath = `${process.cwd()}/src/app/pages/auth/styles.css.ts`;
  const { source } = await compile({ filePath, cwd: process.cwd() });
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

  it('is a blurred band faded at all four edges, with no border or radius', async () => {
    const [rule] = declarations(await emitted(), over);
    const mask = rule.find((d) => d.startsWith('mask-image:')) ?? '';
    expect(mask).toContain('to bottom');
    expect(mask).toContain('to right');
    expect(rule).toContain('mask-composite: intersect');
    expect(rule.some((d) => d.startsWith('backdrop-filter: blur('))).toBe(true);
    expect(rule.filter((d) => /^(border|border-radius)/.test(d))).toEqual([]);
  });
});
