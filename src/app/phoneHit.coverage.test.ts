import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { classLists, emitted, expectPhoneHitClasses, phoneHitClasses } from './phoneHitTestKit';

// Every IconButton under src carries a PhoneHit class, or is named here with the reason it has none. The per-group
// suites pin which variant a listed file's buttons carry; this one sees files no group lists, so a new bare
// IconButton fails here instead of shipping with a sub-44px phone hit area.
const EXEMPT: Record<string, { indices: number[]; why: string }> = {
  'features/estate/EstateNavigator.tsx': {
    indices: [0],
    why: 'Find a room sits in a css.Targets row that already gives it a 44 px phone target',
  },
  'features/lobby/LobbyHeader.tsx': {
    indices: [1],
    why: 'Members button, hidden on mobile',
  },
};

const tsxFiles = (dir: string): string[] =>
  readdirSync(`${process.cwd()}/src/app/${dir}`, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return tsxFiles(`${dir}${e.name}/`);
    return e.name.endsWith('.tsx') ? [`${dir}${e.name}`] : [];
  });

describe('phone hit areas: every IconButton is covered or named', () => {
  it('lists exactly the IconButtons without a PhoneHit class', () => {
    const bare: Record<string, number[]> = {};
    tsxFiles('').forEach((file) => {
      const src = readFileSync(`${process.cwd()}/src/app/${file}`, 'utf8');
      if (!src.includes('<IconButton')) return;
      const missing = phoneHitClasses(src).flatMap((c, i) => (c === null ? [i] : []));
      if (missing.length > 0) bare[file] = missing;
    });
    expect(bare).toEqual(
      Object.fromEntries(Object.entries(EXEMPT).map(([f, e]) => [f, e.indices]))
    );
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
