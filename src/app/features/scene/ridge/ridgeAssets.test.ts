// The committed baked set under public/ridge: what the baker wrote is what ships, within the budget the baker itself refuses on
// (export.py MAX_CARDS, TOTAL_BYTES_MAX, DECODE_BYTES_MAX). Reads with node fs. The gate reads each card file's own bytes, not the manifest's
// claims about them: the WebP container is walked and its stated dimensions (VP8X canvas, VP8 / VP8L frame header) must equal the card's
// width and band height, which the decode budget is computed from; and the bake id is re-derived from the card bytes as the baker derives it,
// so any corruption of a card, same length or not, fails. No pixel decoder is in the tree; the baker's own check decodes pixels.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_CARDS, parseIndex, parseManifest } from './manifest';

/** The same constants as scripts/ridge-bake/export.py: every card file of a place, and the cards decoded (2 textures x w x band rows x 4 bytes each). */
export const TOTAL_BYTES_MAX = 1_500_000;
export const DECODE_BYTES_MAX = 20_000_000;

interface WireFile {
  file: string;
  bytes: number;
}
interface WireCard {
  top: number;
  h: number;
  scale: number;
  colour: WireFile;
  geometry: WireFile;
}
export interface WireManifest {
  bake_id: string;
  w: number;
  cards: WireCard[];
  camera?: { heading_max_deg?: number };
}

const files = (c: WireCard): WireFile[] => [c.colour, c.geometry];

/** Why a manifest breaks the size gate, or undefined: too many cards, too many bytes, or too many decoded bytes. */
export function sizeGate(m: WireManifest): string | undefined {
  if (m.cards.length > MAX_CARDS) return `${m.cards.length} cards, above ${MAX_CARDS}`;
  const bytes = m.cards.flatMap(files).reduce((a, f) => a + f.bytes, 0);
  if (bytes > TOTAL_BYTES_MAX) return `the cards are ${bytes} bytes, above ${TOTAL_BYTES_MAX}`;
  const decoded = m.cards.reduce((a, c) => a + 2 * m.w * c.h * 4, 0);
  return decoded > DECODE_BYTES_MAX
    ? `the cards decode to ${decoded} bytes, above ${DECODE_BYTES_MAX}`
    : undefined;
}

/** Why `b` is not the WebP of `w` x `h` pixels, or undefined: the RIFF container is walked, so a cut or padded file and a changed frame header fail. */
export function webpFault(b: Uint8Array, w: number, h: number): string | undefined {
  const u32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return 'not a RIFF WEBP';
  if (u32(4) + 8 !== b.length) return `RIFF size ${u32(4)} does not fit a ${b.length} byte file`;
  const dims: string[] = [];
  let seen = 0;
  let o = 12;
  while (o < b.length) {
    if (o + 8 > b.length) return 'a chunk header runs past the file';
    const id = tag(o);
    const len = u32(o + 4);
    const body = o + 8;
    if (body + len > b.length) return `chunk ${id} runs past the file`;
    if (id === 'VP8X') dims.push(`${u24(body + 4) + 1}x${u24(body + 7) + 1}`);
    if (id === 'VP8 ') {
      if (b[body + 3] !== 0x9d || b[body + 4] !== 0x01 || b[body + 5] !== 0x2a)
        return 'VP8 start code missing';
      dims.push(
        `${(b[body + 6] | (b[body + 7] << 8)) & 0x3fff}x${
          (b[body + 8] | (b[body + 9] << 8)) & 0x3fff
        }`
      );
      seen += 1;
    }
    if (id === 'VP8L') {
      if (b[body] !== 0x2f) return 'VP8L signature missing';
      const bits = u32(body + 1);
      dims.push(`${(bits & 0x3fff) + 1}x${((bits >>> 14) & 0x3fff) + 1}`);
      seen += 1;
    }
    o = body + len + (len & 1);
  }
  if (o !== b.length) return 'the chunks do not tile the file';
  if (seen !== 1) return `${seen} bitstream chunks`;
  const bad = dims.find((d) => d !== `${w}x${h}`);
  return bad ? `states ${bad}, the manifest ${w}x${h}` : undefined;
}

/** The baker's bake id (export.py `bake_id`): first 12 hex of sha256 over the card files in index order, colour then geometry. */
export function bakeIdOf(
  cardBytes: (card: number, kind: 'colour' | 'geometry') => Uint8Array,
  n: number
): string {
  const h = createHash('sha256');
  for (let i = 0; i < n; i += 1) {
    h.update(cardBytes(i, 'colour'));
    h.update(cardBytes(i, 'geometry'));
  }
  return h.digest('hex').slice(0, 12);
}

const ROOT = join(process.cwd(), 'public', 'ridge');
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const index = parseIndex(readJson(join(ROOT, 'index.json')));
const dirs = Object.entries(index.places);

describe('the committed ridge assets', () => {
  it('ship at least one place, and the index default is one of them', () => {
    expect(dirs.length).toBeGreaterThan(0);
    expect(index.places[index.default]).toBeDefined();
  });

  dirs.forEach(([id, dir]) => {
    describe(`${id} (${dir})`, () => {
      const raw = readJson(join(ROOT, dir, 'manifest.json')) as WireManifest & { schema: number };
      const read = (f: WireFile) => readFileSync(join(ROOT, dir, f.file));

      it('is schema 2, parses, and its directory ends in its bake id', () => {
        expect(raw.schema).toBe(2);
        expect(() => parseManifest(raw, `${dir}/`)).not.toThrow();
        expect(dir.endsWith(`-${raw.bake_id}`)).toBe(true);
      });

      it('has every card file, at the length the manifest states', () => {
        raw.cards.flatMap(files).forEach((f) => {
          expect(statSync(join(ROOT, dir, f.file)).size, f.file).toBe(f.bytes);
        });
      });

      it('decodes every card file as the WebP of the width and band height the manifest states', () => {
        raw.cards.forEach((c) =>
          files(c).forEach((f) => {
            expect(webpFault(read(f), raw.w, c.h), f.file).toBeUndefined();
          })
        );
      });

      it('holds the bytes its bake id was made from', () => {
        const bytes = (i: number, kind: 'colour' | 'geometry') => read(raw.cards[i][kind]);
        expect(bakeIdOf(bytes, raw.cards.length)).toBe(raw.bake_id);
      });

      it('keeps the place inside the card, byte and decode budget', () => {
        expect(sizeGate(raw)).toBeUndefined();
      });

      it('carries its camera and a scale for every card', () => {
        expect(Number.isFinite(raw.camera?.heading_max_deg)).toBe(true);
        raw.cards.forEach((c) => expect(Number.isFinite(c.scale) && c.scale > 0).toBe(true));
      });
    });
  });

  it('shows Vienna from a camera pushed forward: no card is smaller than its bake', () => {
    const vienna = index.places.vienna;
    expect(vienna).toBeDefined();
    const m = readJson(join(ROOT, vienna, 'manifest.json')) as WireManifest;
    m.cards.forEach((c) => expect(c.scale).toBeGreaterThanOrEqual(1));
  });

  it('holds no file a manifest does not name', () => {
    const named = new Set<string>(['index.json']);
    dirs.forEach(([, dir]) => {
      named.add(`${dir}/manifest.json`);
      (readJson(join(ROOT, dir, 'manifest.json')) as WireManifest).cards
        .flatMap(files)
        .forEach((f) => named.add(`${dir}/${f.file}`));
    });
    const onDisk = readdirSync(ROOT, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) =>
        join(e.parentPath, e.name)
          .slice(ROOT.length + 1)
          .split(sep)
          .join('/')
      );
    expect(onDisk.filter((f) => !named.has(f))).toEqual([]);
    expect([...named].filter((f) => !existsSync(join(ROOT, f)))).toEqual([]);
  });
});

describe('the card gates refuse a card that is not what the manifest says', () => {
  const dir = Object.values(index.places)[0];
  const manifest = readJson(join(ROOT, dir, 'manifest.json')) as WireManifest;
  const real = readFileSync(join(ROOT, dir, manifest.cards[1].geometry.file));
  const { h } = manifest.cards[1];
  const w = manifest.w;
  const id = (b: Uint8Array) => bakeIdOf(() => b, 1);

  it('accepts the real card at its size', () => {
    expect(webpFault(real, w, h)).toBeUndefined();
  });
  it("refuses a manifest that lies about the card's size, and a file cut short or padded", () => {
    expect(webpFault(real, w, h + 1)).toMatch(/states/);
    expect(webpFault(real.subarray(0, real.length - 1), w, h)).toBeDefined();
    expect(webpFault(Buffer.concat([real, Buffer.from([0])]), w, h)).toBeDefined();
  });
  it('refuses bytes that are not a WebP', () => {
    expect(webpFault(Buffer.from('not a webp, but long enough to try'), w, h)).toMatch(/RIFF/);
  });
  it('re-derives a different bake id from a card with the same length and 8 bytes overwritten', () => {
    const bad = Buffer.from(real);
    bad.fill(0xab, 100, 108);
    expect(bad.length).toBe(real.length);
    expect(id(bad)).not.toBe(id(real));
  });
  it('derives the id from colour then geometry, in card order', () => {
    const a = Buffer.from('a-colour');
    const b = Buffer.from('b-geometry');
    const order = (c: number, k: 'colour' | 'geometry') => (c === 0 && k === 'colour' ? a : b);
    const swapped = (c: number, k: 'colour' | 'geometry') => (c === 0 && k === 'colour' ? b : a);
    const want = createHash('sha256').update(a).update(b).update(b).update(b);
    expect(bakeIdOf(order, 2)).toBe(want.digest('hex').slice(0, 12));
    expect(bakeIdOf(swapped, 2)).not.toBe(bakeIdOf(order, 2));
  });
});

describe('sizeGate', () => {
  const card = (bytes: number, h: number): WireCard => ({
    top: 0,
    h,
    scale: 1,
    colour: { file: 'c.webp', bytes },
    geometry: { file: 'g.webp', bytes },
  });
  const set = (n: number, bytes: number, h: number): WireManifest => ({
    bake_id: 'x',
    w: 1280,
    cards: Array.from({ length: n }, () => card(bytes, h)),
  });

  it('passes a place at the byte budget and fails one a byte over', () => {
    expect(sizeGate(set(3, 250_000, 100))).toBeUndefined();
    expect(sizeGate(set(3, 250_001, 100))).toMatch(/1500006 bytes/);
  });

  it('fails a seventh card, and cards that decode past the budget', () => {
    expect(sizeGate(set(6, 1, 150))).toBeUndefined();
    expect(sizeGate(set(7, 1, 150))).toMatch(/7 cards/);
    expect(sizeGate(set(2, 1, 600))).toBeUndefined();
    expect(sizeGate(set(4, 1, 600))).toMatch(/decode/);
  });
});
