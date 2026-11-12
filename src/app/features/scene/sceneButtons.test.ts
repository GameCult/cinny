import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { describe, expect, it } from 'vitest';

// sceneButtons.css.ts restyles folds' Button and Chip by their hashed recipe base classes. A folds upgrade rehashes
// them and the chromeless buttons would silently revert, so resolve the classes from the installed folds.
const foldsDir = dirname(createRequire(import.meta.url).resolve('folds/package.json'));
const dist = readFileSync(join(foldsDir, 'dist/index.js'), 'utf8');
const css = readFileSync(join(foldsDir, 'dist/style.css'), 'utf8');
const sceneButtons = readFileSync(
  `${process.cwd()}/src/app/features/scene/sceneButtons.css.ts`,
  'utf8'
);

const recipeBase = (name: string) =>
  new RegExp(`\\b${name}\\$1 = createRuntimeFn\\(\\{ defaultClassName: "([^" ]+)`).exec(dist)?.[1];
const pinned = (name: string) => new RegExp(`${name} = '([^']+)'`).exec(sceneButtons)?.[1];

describe('sceneButtons pins folds recipe base classes', () => {
  it.each([
    ['Button', 'FOLDS_BUTTON_CLASS'],
    ['Chip', 'FOLDS_CHIP_CLASS'],
  ])('%s base class matches the installed folds', (recipe, constant) => {
    const base = recipeBase(recipe);
    expect(base, `folds no longer builds ${recipe} with createRuntimeFn`).toBeTruthy();
    expect(pinned(constant)).toBe(base);
    expect(css).toContain(`.${base} {`);
  });
});
