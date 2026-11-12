import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/manifest.json'), 'utf8'));

describe('web app manifest', () => {
  it('has a stable identity and scope, and no orientation lock', () => {
    expect(manifest.id).toBe('/'); // what Chrome already derives from start_url "./" at the site root
    expect(manifest.scope).toBe('./');
    expect(manifest.start_url).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBeUndefined();
  });
  it('offers 192 and 512 icons for any use and a 512 maskable one, every file present', () => {
    const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
    const any = icons.filter((i) => !i.purpose);
    expect(any.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    const maskable = icons.filter((i) => i.purpose === 'maskable');
    expect(maskable.map((i) => i.sizes)).toEqual(['512x512']);
    // the build copies public/res/android to public/android (vite.config.js)
    icons.forEach((i) =>
      expect(
        existsSync(join(ROOT, i.src.replace('./public/android/', 'public/res/android/')))
      ).toBe(true)
    );
  });
});
