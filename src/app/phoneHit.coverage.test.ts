import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  classLists,
  emitted,
  expectPhoneHitClasses,
  uncoveredIconButtons,
} from './phoneHitTestKit';

// Every IconButton under src carries a PhoneHit class, or is named here with the reason it has none. The per-group
// suites pin which variant a listed file's buttons carry; this one sees files no group lists, so a new bare
// IconButton fails here instead of shipping with a sub-44px phone hit area.
const EXEMPT: Record<string, { indices: number[]; why: string }> = {
  'app/features/estate/EstateNavigator.tsx': {
    indices: [0],
    why: 'Find a room sits in a css.Targets row that already gives it a 44 px phone target',
  },
  'app/features/lobby/LobbyHeader.tsx': {
    indices: [1],
    why: 'Members button, hidden on mobile',
  },
};

// Every script file, not only .tsx: an IconButton can be rendered from a .ts or .js module too. A file that never
// says IconButton is skipped; one that does is parsed and every mention of it must be a tag the guard can check.
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const sourceFiles = (dir: string): string[] =>
  readdirSync(`${process.cwd()}/src/${dir}`, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return sourceFiles(`${dir}${e.name}/`);
    return SCRIPT.test(e.name) ? [`${dir}${e.name}`] : [];
  });

describe('phone hit areas: every IconButton is covered or named', () => {
  const scanned = sourceFiles('').flatMap((file) => {
    const src = readFileSync(`${process.cwd()}/src/${file}`, 'utf8');
    return src.includes('IconButton') ? [{ file, ...uncoveredIconButtons(src, file) }] : [];
  });

  it('lists exactly the IconButtons without a PhoneHit class', () => {
    expect(scanned.length).toBeGreaterThan(0);
    const bare: Record<string, number[]> = {};
    scanned.forEach(({ file, bare: missing }) => {
      if (missing.length > 0) bare[file] = missing;
    });
    expect(bare).toEqual(
      Object.fromEntries(Object.entries(EXEMPT).map(([f, e]) => [f, e.indices]))
    );
  });

  // An IconButton passed as a value (as={IconButton}), re-bound, re-exported or destructured cannot be tied to a
  // PhoneHit class, so the guard names it instead of passing over it. Render it as a <IconButton> tag, or extend the
  // guard to read the new form.
  it('finds no IconButton the guard cannot check', () => {
    const unhandled: Record<string, string[]> = {};
    scanned.forEach(({ file, unhandled: found }) => {
      if (found.length > 0) unhandled[file] = found;
    });
    expect(unhandled).toEqual({});
  });
});

// UrlPreviewCard's arrows are absolutely positioned by their own class; PhoneHit would set position: relative on them
// and win or lose by stylesheet order, so they carry the variant that adds only the hit area.
describe('phone hit area of a button positioned by its own class', () => {
  it('the arrows carry PhoneHitInPlace', () => {
    expectPhoneHitClasses('components/url-preview/UrlPreviewCard.tsx', [
      'PhoneHitInPlace',
      'PhoneHitInPlace',
    ]);
  });

  it('PhoneHitInPlace draws the ::after and sets no position of its own', async () => {
    const lists = await classLists('styles/PhoneHit.css.ts');
    expect(lists.PhoneHitInPlace).toHaveLength(1);
    const css = await emitted('styles/PhoneHit.css.ts');
    const rules = [...css.matchAll(/^([^{}\n]*PhoneHitInPlace__[^{}\n]*) \{$/gm)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((sel) => expect(sel).toMatch(/::after$/));
  });
});
