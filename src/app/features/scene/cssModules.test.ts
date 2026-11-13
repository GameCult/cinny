import { describe, expect, it } from 'vitest';
import { compile, processVanillaFile } from '@vanilla-extract/integration';

// vitest imports a .css.ts through the vanilla plugin, which is lenient; `vite build` compiles it with
// vanilla-extract's integration, which refuses a function export. Compile the scene's .css.ts files the build's way.
const FILES = [
  'src/app/features/scene/sceneShell.css.ts',
  'src/app/features/room-nav/styles.css.ts',
  'src/app/components/nav/styles.css.ts',
];

describe('scene .css.ts files, compiled as the production build compiles them', () => {
  it.each(FILES)('%s compiles with exports vanilla-extract accepts', async (file) => {
    const filePath = `${process.cwd()}/${file}`;
    const { source } = await compile({ filePath, cwd: process.cwd(), identOption: 'debug' });
    await expect(
      processVanillaFile({ source, filePath, identOption: 'debug' })
    ).resolves.toBeTypeOf('string');
  });
});
