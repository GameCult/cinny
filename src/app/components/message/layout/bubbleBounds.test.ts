import { describe, expect, it } from 'vitest';
import zlib from 'zlib';
import { compile, processVanillaFile } from '@vanilla-extract/integration';

// A long reply quote (nowrap) sized the own-message row to 782px on a 390px phone. The row, the column and the bubble
// must be able to shrink to their parent, so pin the emitted declarations (as phoneTapTargets.test.ts does).
const emitted = async () => {
  const filePath = `${process.cwd()}/src/app/components/message/layout/layout.css.ts`;
  const { source } = await compile({ filePath, cwd: process.cwd(), identOption: 'debug' });
  const code = await processVanillaFile({ source, filePath, identOption: 'debug' });
  const bytes = Buffer.from(
    (code.match(/source=#?([A-Za-z0-9+/=]+)/) as RegExpMatchArray)[1],
    'base64'
  );
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes).toString();
};

const declarations = (css: string, className: string): string[] => {
  const rule = new RegExp(`^\\.layout_${className}__[\\w-]+ \\{\\n([^}]*)\\}`, 'm').exec(css);
  expect(rule, `no .layout_${className} rule emitted`).toBeTruthy();
  return (rule as RegExpExecArray)[1].split('\n').map((l) => l.trim().replace(/;$/, ''));
};

describe('bubble rows shrink to their column', () => {
  it.each([
    ['BubbleColumn', ['min-width: 0']],
    ['BubbleContentRow', ['min-width: 0', 'max-width: 100%']],
    ['BubbleContent', ['min-width: 0']],
  ])('%s', async (name, expected) => {
    const css = await emitted();
    expect(declarations(css, name)).toEqual(expect.arrayContaining(expected));
  });

  it('BubbleContent keeps its 800px cap inside the column width', async () => {
    const css = await emitted();
    expect(declarations(css, 'BubbleContent').join('\n')).toMatch(/max-width: min\(100%, 50rem\)/);
  });
});
