// The committed baked set under public/ridge: what the baker wrote is what ships, within the budget the baker itself refuses on (export.py MAX_CARDS,
// TILE_BYTES_MAX, PLACE_BYTES_MAX, RESIDENT_BYTES_MAX). Reads with node fs. The gate reads each tile file's own bytes, not the manifest's claims about
// them: the WebP container is walked and its stated dimensions (VP8X canvas, VP8 / VP8L frame header) must equal the tile's width (tile_w + 2 apron) and
// its band height, which the resident budget is computed from; and the bake id is re-derived from the tile bytes as the baker derives it (tile-major, then
// card, colour then geometry), so any corruption of a tile, same length or not, fails. No pixel decoder is in the tree; the baker's own check decodes pixels.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_CARDS, parseIndex, parseManifest } from './manifest';
import { runTiles } from './ring';
import { groundRowsNeeded, HFOV_MAX_DEG } from './view';

/** The same constants as scripts/ridge-bake/export.py. */
export const TILE_BYTES_MAX = 235_000;
export const PLACE_BYTES_MAX = 7_500_000;
export const RESIDENT_BYTES_MAX = 20_000_000;
/** As ridge.py NEAR_CLIP_M: the far march's first sample; card 0's distance_m is measured at or beyond it (the near ground under it is not measured). */
export const NEAR_CLIP_M = 500;

interface WireFile {
  file: string;
  bytes: number;
}
interface WireTile {
  top: number;
  h: number;
  distance_m: number;
  colour: WireFile;
  geometry: WireFile;
}
export interface WireManifest {
  schema: number;
  bake_id: string;
  view: { ring_w: number; tile_w: number; tiles: number; apron: number; plane_h: number; horizon_row: number };
  camera: { r_max_m: number; r_max_forward_m: number };
  cards: unknown[];
  tiles: (WireTile | null)[][];
}

const files = (e: WireTile | null): WireFile[] => (e ? [e.colour, e.geometry] : []);
const bytesOf = (row: (WireTile | null)[]): number =>
  row.flatMap(files).reduce((a, f) => a + f.bytes, 0);

/**
 * N and the lit bytes of the worst run of N consecutive tiles (4 bytes x (tile_w + 2) x band rows, per card), cyclic: the same N and the same sum as
 * export.py `run_tiles` and `resident_bytes`, recomputed from the manifest alone, at the larger of the two offsets the bake ships. The nearest distance is card 0's smallest over the tiles.
 */
export function residentBytes(m: WireManifest): { n: number; bytes: number } {
  const { tiles, tile_w } = m.view;
  const rmin = Math.min(...m.tiles.flatMap((row) => (row[0] ? [row[0].distance_m] : [])));
  const n = runTiles({ tiles }, HFOV_MAX_DEG, Math.max(m.camera.r_max_m, m.camera.r_max_forward_m), rmin);
  const per = m.tiles.map((row) => row.reduce((a, e) => a + (e ? 4 * (tile_w + 2) * e.h : 0), 0));
  let worst = 0;
  for (let t = 0; t < tiles; t += 1) {
    let sum = 0;
    for (let k = 0; k < n; k += 1) sum += per[(t + k) % tiles];
    worst = Math.max(worst, sum);
  }
  return { n, bytes: worst };
}

/** Why a manifest breaks the size gate, or undefined: too many cards, a tile or the place too many bytes, or the resident run lit past the budget. */
export function sizeGate(m: WireManifest): string | undefined {
  if (m.cards.length > MAX_CARDS) return `${m.cards.length} cards, above ${MAX_CARDS}`;
  const tileBytes = m.tiles.map(bytesOf);
  const worst = tileBytes.findIndex((b) => b > TILE_BYTES_MAX);
  if (worst >= 0) return `tile ${worst} is ${tileBytes[worst]} bytes, above ${TILE_BYTES_MAX}`;
  const total = tileBytes.reduce((a, b) => a + b, 0);
  if (total > PLACE_BYTES_MAX) return `the place is ${total} bytes, above ${PLACE_BYTES_MAX}`;
  const res = residentBytes(m);
  return res.bytes > RESIDENT_BYTES_MAX
    ? `${res.n} consecutive tiles light to ${res.bytes} bytes, above ${RESIDENT_BYTES_MAX}`
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

const BLANK_ID = '0'.repeat(12);

/** The manifest text as the baker hashed it: the bytes as committed, with the bake_id value blanked (an id cannot hash itself). */
export function blankedManifest(text: string, bakeId: string): string {
  return text.replace(`"bake_id": "${bakeId}"`, `"bake_id": "${BLANK_ID}"`);
}

/** The baker's bake id (export.py `bake_id`): first 12 hex of sha256 over the blanked manifest text, then the tile files, tile-major then card, colour then geometry (a card absent from a tile writes none): the id addresses the whole bake. */
export function bakeIdOf(blankManifest: string, tileFiles: Uint8Array[]): string {
  const h = createHash('sha256');
  h.update(blankManifest, 'utf8');
  tileFiles.forEach((b) => h.update(b));
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
      const raw = readJson(join(ROOT, dir, 'manifest.json')) as WireManifest;
      const read = (f: WireFile) => readFileSync(join(ROOT, dir, f.file));
      const all = raw.tiles.flatMap((row) => row.flatMap(files));

      it('is schema 3, parses, and its directory ends in its bake id', () => {
        expect(raw.schema).toBe(3);
        expect(() => parseManifest(raw, `${dir}/`)).not.toThrow();
        expect(dir.endsWith(`-${raw.bake_id}`)).toBe(true);
      });

      it('names a time zone Intl knows (the sky draws its named moments in the place local day)', () => {
        const tz = (raw as unknown as { place: { tz?: unknown } }).place.tz;
        expect(typeof tz).toBe('string');
        expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz as string })).not.toThrow();
      });

      it('has every tile file, at the length the manifest states', () => {
        all.forEach((f) => {
          expect(statSync(join(ROOT, dir, f.file)).size, f.file).toBe(f.bytes);
        });
      });

      it('decodes every tile file as the WebP of tile_w + 2 apron columns by the band height the manifest states', () => {
        const w = raw.view.tile_w + 2 * raw.view.apron;
        raw.tiles.forEach((row) =>
          row.forEach((e) =>
            files(e).forEach((f) => {
              expect(webpFault(read(f), w, (e as WireTile).h), f.file).toBeUndefined();
            })
          )
        );
      });

      it('holds the manifest and the bytes its bake id was made from', () => {
        const ordered = raw.tiles.flatMap((row) => row.flatMap(files)).map(read);
        const text = blankedManifest(readFileSync(join(ROOT, dir, 'manifest.json'), 'utf8'), raw.bake_id);
        expect(text).toContain(`"bake_id": "${BLANK_ID}"`);
        expect(bakeIdOf(text, ordered)).toBe(raw.bake_id);
        expect(bakeIdOf(text.replace('"r_max_forward_m"', '"r_max_forward_m "'), ordered), 'a changed manifest keeps its id').not.toBe(raw.bake_id);
      });

      it('is checked out as committed: git converts no line end of the manifest, the index or a tile, so the bytes served are the bytes the id was made from', () => {
        const attr = (file: string) =>
          execFileSync('git', ['check-attr', 'text', 'eol', '--', file], { encoding: 'utf8' }).replace(/\r/g, '').trim().split('\n');
        const tile = files(raw.tiles[0].find((e) => e)!)[0].file;
        [`public/ridge/${dir}/manifest.json`, 'public/ridge/index.json', `public/ridge/${dir}/${tile}`].forEach((f) =>
          expect(attr(f), f).toEqual([`${f}: text: unset`, `${f}: eol: unspecified`])
        );
        expect(readFileSync(join(ROOT, dir, 'manifest.json'), 'utf8')).not.toContain('\r');
      });

      it('keeps the place inside the tile, place and resident budgets, computed from the manifest alone', () => {
        expect(sizeGate(raw)).toBeUndefined();
        expect(residentBytes(raw).n).toBeLessThanOrEqual(raw.view.tiles);
      });

      it('keeps the ground rows the runtime needs under the horizon and nothing nearer than the near clip: card 0 stands at or beyond 500 m in every tile', () => {
        expect(raw.view.plane_h - raw.view.horizon_row).toBeGreaterThanOrEqual(groundRowsNeeded(raw.view.plane_h) - 1e-6);
        raw.tiles.forEach((row) => row[0] && expect(row[0].distance_m).toBeGreaterThanOrEqual(NEAR_CLIP_M));
      });

      it('carries the offset bound and a distance for every tile a card holds', () => {
        expect(raw.camera.r_max_m).toBeGreaterThan(0);
        expect(raw.camera.r_max_forward_m).toBeGreaterThanOrEqual(raw.camera.r_max_m);
        raw.tiles.forEach((row) => row.forEach((e) => e && expect(e.distance_m).toBeGreaterThan(0)));
        raw.cards.forEach((_, i) => expect(raw.tiles.some((row) => row[i] !== null)).toBe(true));
      });
    });
  });

  it('holds no file a manifest does not name', () => {
    const named = new Set<string>(['index.json']);
    dirs.forEach(([, dir]) => {
      named.add(`${dir}/manifest.json`);
      (readJson(join(ROOT, dir, 'manifest.json')) as WireManifest).tiles
        .flatMap((row) => row.flatMap(files))
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

describe('the tile gates refuse a tile that is not what the manifest says', () => {
  const dir = Object.values(index.places)[0];
  const manifest = readJson(join(ROOT, dir, 'manifest.json')) as WireManifest;
  const e = manifest.tiles.map((row) => row[1]).find((x) => x) as WireTile;
  const real = readFileSync(join(ROOT, dir, e.geometry.file));
  const { h } = e;
  const w = manifest.view.tile_w + 2 * manifest.view.apron;

  it('accepts the real tile at its size', () => {
    expect(webpFault(real, w, h)).toBeUndefined();
  });
  it("refuses a manifest that lies about the tile's size, and a file cut short or padded", () => {
    expect(webpFault(real, w, h + 1)).toMatch(/states/);
    expect(webpFault(real, manifest.view.tile_w, h)).toMatch(/states/); // a tile without its apron
    expect(webpFault(real.subarray(0, real.length - 1), w, h)).toBeDefined();
    expect(webpFault(Buffer.concat([real, Buffer.from([0])]), w, h)).toBeDefined();
  });
  it('refuses bytes that are not a WebP', () => {
    expect(webpFault(Buffer.from('not a webp, but long enough to try'), w, h)).toMatch(/RIFF/);
  });
  it('re-derives a different bake id from a tile with the same length and 8 bytes overwritten', () => {
    const bad = Buffer.from(real);
    bad.fill(0xab, 100, 108);
    expect(bad.length).toBe(real.length);
    expect(bakeIdOf('m', [bad])).not.toBe(bakeIdOf('m', [real]));
  });
  it('derives the id over the files in the order the baker writes them: any other order is another id', () => {
    const [a, b, c] = [Buffer.from('t0-c0-colour'), Buffer.from('t0-c0-geometry'), Buffer.from('t1-c0-colour')];
    const want = createHash('sha256').update('manifest').update(a).update(b).update(c).digest('hex').slice(0, 12);
    expect(bakeIdOf('manifest', [a, b, c])).toBe(want);
    expect(bakeIdOf('manifest', [a, c, b])).not.toBe(want);
    expect(bakeIdOf('manifest', [b, a, c])).not.toBe(want);
    expect(bakeIdOf('manifest!', [a, b, c])).not.toBe(want);
  });
});

describe('sizeGate', () => {
  const entry = (bytes: number, h = 100): WireTile => ({
    top: 0,
    h,
    distance_m: 1000,
    colour: { file: 'c.webp', bytes: Math.floor(bytes / 2) },
    geometry: { file: 'g.webp', bytes: bytes - Math.floor(bytes / 2) },
  });
  const ring = (tiles: number, perTile: number, h = 100, cards = 1): WireManifest => ({
    schema: 3,
    bake_id: 'x',
    view: { ring_w: 6400, tile_w: 6400 / tiles, tiles, apron: 2, plane_h: 600, horizon_row: 357 },
    camera: { r_max_m: 50, r_max_forward_m: 50 },
    cards: Array.from({ length: cards }, () => ({})),
    tiles: Array.from({ length: tiles }, () =>
      Array.from({ length: cards }, () => entry(perTile / cards, h))
    ),
  });

  it('passes a tile at the byte cap and fails one a byte over', () => {
    expect(sizeGate(ring(32, 7000, 10))).toBeUndefined();
    const at = ring(32, 1, 10);
    expect(sizeGate({ ...at, tiles: [[entry(TILE_BYTES_MAX, 10)], ...at.tiles.slice(1)] })).toBeUndefined();
    expect(sizeGate({ ...at, tiles: [[entry(TILE_BYTES_MAX + 1, 10)], ...at.tiles.slice(1)] })).toMatch(
      /tile 0 is 235001 bytes/
    );
  });

  it('passes a place at the byte cap and fails one a byte over', () => {
    // 32 tiles at 234 375 bytes is exactly 7 500 000; one byte more on one tile is over.
    const at = ring(32, PLACE_BYTES_MAX / 32, 10);
    expect(sizeGate(at)).toBeUndefined();
    const over = { ...at, tiles: [[entry(PLACE_BYTES_MAX / 32 + 1, 10)], ...at.tiles.slice(1)] };
    expect(sizeGate(over)).toMatch(/the place is 7500001 bytes/);
  });

  it('fails a seventh card, and a ring that lights past the resident budget by a row', () => {
    expect(sizeGate({ ...ring(32, 1, 10), cards: Array(7).fill({}) })).toMatch(/7 cards/);
    const n = residentBytes(ring(32, 1, 100)).n;
    const rows = Math.floor(RESIDENT_BYTES_MAX / (n * 4 * 202)); // the most rows N tiles can hold lit within the budget
    expect(sizeGate(ring(32, 1, rows))).toBeUndefined();
    expect(sizeGate(ring(32, 1, rows + 1))).toMatch(/consecutive tiles light to/);
  });
});
